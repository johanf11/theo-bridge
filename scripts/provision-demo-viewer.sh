#!/usr/bin/env bash
# Provision viewer@caribbeanimport.demo on Caribbean Import Group S.A.
# Mirrors the live treasury@caribbeanimport.demo org_members pattern.
#
# Requires:
#   SUPABASE_ACCESS_TOKEN — Supabase personal access token (Management API)
#
# Optional:
#   VIEWER_EMAIL          — default viewer@caribbeanimport.demo
#   VIEWER_PASSWORD       — demo login password (min 12 chars); generated if unset
#   PROJECT_REF           — default nlbnmsiqfywskuxhqjon

set -euo pipefail

PROJECT_REF="${PROJECT_REF:-nlbnmsiqfywskuxhqjon}"
SUPABASE_URL="https://${PROJECT_REF}.supabase.co"
VIEWER_EMAIL="${VIEWER_EMAIL:-viewer@caribbeanimport.demo}"
TREASURY_EMAIL="${TREASURY_EMAIL:-treasury@caribbeanimport.demo}"
COMPANY_NAME="Caribbean Import Group S.A."

if [[ -z "${SUPABASE_ACCESS_TOKEN:-}" ]]; then
  echo "ERROR: SUPABASE_ACCESS_TOKEN is required" >&2
  exit 1
fi

if [[ -z "${VIEWER_PASSWORD:-}" ]]; then
  VIEWER_PASSWORD="ViewerDemo2026!"
fi

if ((${#VIEWER_PASSWORD} < 12)); then
  echo "ERROR: VIEWER_PASSWORD must be at least 12 characters" >&2
  exit 1
fi

mgmt() {
  local method="$1"
  local path="$2"
  local body="${3:-}"
  if [[ -n "$body" ]]; then
    curl -sS -X "$method" "https://api.supabase.com/v1/projects/${PROJECT_REF}${path}" \
      -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
      -H "Content-Type: application/json" \
      -d "$body"
  else
    curl -sS -X "$method" "https://api.supabase.com/v1/projects/${PROJECT_REF}${path}" \
      -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
      -H "Content-Type: application/json"
  fi
}

sql_query() {
  local query="$1"
  mgmt POST "/database/query" "$(jq -n --arg q "$query" '{query: $q}')"
}

echo "=== Step 1: Inspect CIG org and treasury@ setup ==="

CIG_INFO="$(sql_query "SELECT c.id AS customer_id, c.company_name, c.user_id AS owner_user_id, ou.email AS owner_email FROM customers c LEFT JOIN auth.users ou ON ou.id = c.user_id WHERE c.company_name = '${COMPANY_NAME}' LIMIT 1;")"
echo "$CIG_INFO" | jq .

CUSTOMER_ID="$(echo "$CIG_INFO" | jq -r '.[0].customer_id // empty')"
if [[ -z "$CUSTOMER_ID" ]]; then
  echo "ERROR: Customer not found: ${COMPANY_NAME}" >&2
  exit 1
fi

ROLES="$(sql_query "SELECT r.id, r.name, r.is_system FROM org_roles r WHERE r.customer_id = '${CUSTOMER_ID}' ORDER BY r.name;")"
echo "$ROLES" | jq .

VIEWER_ROLE_ID="$(echo "$ROLES" | jq -r '.[] | select(.name == "Viewer") | .id' | head -1)"
if [[ -z "$VIEWER_ROLE_ID" ]]; then
  echo "ERROR: Viewer role not found for ${COMPANY_NAME}" >&2
  exit 1
fi

MEMBERS="$(sql_query "SELECT om.id, om.email, om.user_id, om.role_id, r.name AS role_name, om.invited_at, om.accepted_at FROM org_members om JOIN org_roles r ON r.id = om.role_id WHERE om.customer_id = '${CUSTOMER_ID}' ORDER BY om.email;")"
echo "$MEMBERS" | jq .

TREASURY_ROW="$(echo "$MEMBERS" | jq -c --arg e "$TREASURY_EMAIL" '.[] | select(.email == $e)' || true)"
if [[ -n "$TREASURY_ROW" && "$TREASURY_ROW" != "null" ]]; then
  echo "Treasury template:"
  echo "$TREASURY_ROW" | jq .
else
  echo "WARN: ${TREASURY_EMAIL} not found in org_members — proceeding with Viewer defaults"
fi

VIEWER_PERMS="$(sql_query "SELECT r.name, rp.permission, rp.enabled FROM role_permissions rp JOIN org_roles r ON r.id = rp.role_id WHERE r.customer_id = '${CUSTOMER_ID}' AND r.name = 'Viewer' ORDER BY rp.permission;")"
echo "$VIEWER_PERMS" | jq .

ENABLED_COUNT="$(echo "$VIEWER_PERMS" | jq '[.[] | select(.enabled == true)] | length')"
ONLY_VIEW_BALANCES="$(echo "$VIEWER_PERMS" | jq '[.[] | select(.enabled == true) | .permission] | sort == ["view_balances"]')"
if [[ "$ENABLED_COUNT" != "1" || "$ONLY_VIEW_BALANCES" != "true" ]]; then
  echo "ERROR: Viewer role permissions are not view_balances-only" >&2
  exit 1
fi

echo "=== Step 2: Fetch service role key ==="
API_KEYS="$(mgmt GET "/api-keys")"
SERVICE_ROLE="$(echo "$API_KEYS" | jq -r '.[] | select(.name == "service_role") | .api_key' | head -1)"
if [[ -z "$SERVICE_ROLE" || "$SERVICE_ROLE" == "null" ]]; then
  echo "ERROR: Could not fetch service_role API key" >&2
  echo "$API_KEYS" | jq . >&2
  exit 1
fi

auth_admin() {
  local method="$1"
  local path="$2"
  local body="${3:-}"
  if [[ -n "$body" ]]; then
    curl -sS -X "$method" "${SUPABASE_URL}/auth/v1/admin${path}" \
      -H "Authorization: Bearer ${SERVICE_ROLE}" \
      -H "apikey: ${SERVICE_ROLE}" \
      -H "Content-Type: application/json" \
      -d "$body"
  else
    curl -sS -X "$method" "${SUPABASE_URL}/auth/v1/admin${path}" \
      -H "Authorization: Bearer ${SERVICE_ROLE}" \
      -H "apikey: ${SERVICE_ROLE}" \
      -H "Content-Type: application/json"
  fi
}

echo "=== Step 3: Ensure viewer auth user exists ==="
EXISTING_USERS="$(auth_admin GET "/users?email=${VIEWER_EMAIL}")"
VIEWER_USER_ID="$(echo "$EXISTING_USERS" | jq -r '.users[0].id // empty')"

if [[ -z "$VIEWER_USER_ID" ]]; then
  CREATE_RESP="$(auth_admin POST "/users" "$(jq -n \
    --arg email "$VIEWER_EMAIL" \
    --arg password "$VIEWER_PASSWORD" \
    '{email: $email, password: $password, email_confirm: true}')")"
  VIEWER_USER_ID="$(echo "$CREATE_RESP" | jq -r '.id // empty')"
  if [[ -z "$VIEWER_USER_ID" ]]; then
    echo "ERROR: Failed to create auth user" >&2
    echo "$CREATE_RESP" | jq . >&2
    exit 1
  fi
  echo "Created auth user ${VIEWER_EMAIL} (${VIEWER_USER_ID})"
else
  echo "Auth user already exists: ${VIEWER_EMAIL} (${VIEWER_USER_ID})"
  UPDATE_RESP="$(auth_admin PUT "/users/${VIEWER_USER_ID}" "$(jq -n \
    --arg email "$VIEWER_EMAIL" \
    --arg password "$VIEWER_PASSWORD" \
    '{email: $email, password: $password, email_confirm: true}')")"
  echo "$UPDATE_RESP" | jq '{id, email, email_confirmed_at}'
fi

echo "=== Step 4: Upsert org_members (Viewer role) ==="
UPSERT_MEMBER="$(sql_query "INSERT INTO org_members (customer_id, user_id, role_id, email, invited_at, accepted_at) VALUES ('${CUSTOMER_ID}', '${VIEWER_USER_ID}', '${VIEWER_ROLE_ID}', '${VIEWER_EMAIL}', now(), now()) ON CONFLICT (customer_id, email) DO UPDATE SET user_id = EXCLUDED.user_id, role_id = EXCLUDED.role_id, accepted_at = COALESCE(org_members.accepted_at, now()) RETURNING id, email, user_id, role_id, accepted_at;")"
echo "$UPSERT_MEMBER" | jq .

echo "=== Step 5: Ensure platform customer role ==="
USER_ROLE="$(sql_query "INSERT INTO user_roles (user_id, role) VALUES ('${VIEWER_USER_ID}', 'customer') ON CONFLICT (user_id, role) DO NOTHING RETURNING user_id, role;")"
echo "$USER_ROLE" | jq .

echo "=== Step 6: Verify viewer session + permissions ==="
LOGIN_RESP="$(curl -sS -X POST "${SUPABASE_URL}/auth/v1/token?grant_type=password" \
  -H "apikey: ${SERVICE_ROLE}" \
  -H "Content-Type: application/json" \
  -d "$(jq -n --arg email "$VIEWER_EMAIL" --arg password "$VIEWER_PASSWORD" '{email: $email, password: $password}')")"
ACCESS_TOKEN="$(echo "$LOGIN_RESP" | jq -r '.access_token // empty')"
if [[ -z "$ACCESS_TOKEN" ]]; then
  echo "ERROR: Viewer login failed" >&2
  echo "$LOGIN_RESP" | jq . >&2
  exit 1
fi

MEMBER_CHECK="$(curl -sS "${SUPABASE_URL}/rest/v1/org_members?user_id=eq.${VIEWER_USER_ID}&select=customer_id,role_id,accepted_at,email" \
  -H "apikey: ${SERVICE_ROLE}" \
  -H "Authorization: Bearer ${ACCESS_TOKEN}")"
echo "$MEMBER_CHECK" | jq .

ROLE_ID="$(echo "$MEMBER_CHECK" | jq -r '.[0].role_id // empty')"
if [[ "$ROLE_ID" != "$VIEWER_ROLE_ID" ]]; then
  echo "ERROR: Viewer org_members role_id mismatch" >&2
  exit 1
fi

PERMS_CHECK="$(curl -sS "${SUPABASE_URL}/rest/v1/role_permissions?role_id=eq.${VIEWER_ROLE_ID}&enabled=eq.true&select=permission,enabled" \
  -H "apikey: ${SERVICE_ROLE}" \
  -H "Authorization: Bearer ${ACCESS_TOKEN}")"
echo "$PERMS_CHECK" | jq .

PERM_COUNT="$(echo "$PERMS_CHECK" | jq 'length')"
if [[ "$PERM_COUNT" != "1" || "$(echo "$PERMS_CHECK" | jq -r '.[0].permission')" != "view_balances" ]]; then
  echo "ERROR: Viewer effective permissions check failed" >&2
  exit 1
fi

CUSTOMER_CHECK="$(curl -sS "${SUPABASE_URL}/rest/v1/customers?id=eq.${CUSTOMER_ID}&select=id,company_name" \
  -H "apikey: ${SERVICE_ROLE}" \
  -H "Authorization: Bearer ${ACCESS_TOKEN}")"
echo "$CUSTOMER_CHECK" | jq .

echo ""
echo "SUCCESS: ${VIEWER_EMAIL} is an accepted Viewer on ${COMPANY_NAME}"
echo "Demo password: ${VIEWER_PASSWORD}"
