/// <reference types="npm:@types/react@18.3.1" />

import * as React from 'npm:react@18.3.1'

import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Html,
  Link,
  Preview,
  Text,
} from 'npm:@react-email/components@0.0.22'

interface InviteEmailProps {
  siteName: string
  siteUrl: string
  confirmationUrl: string
}

export const InviteEmail = ({ siteName, siteUrl, confirmationUrl }: InviteEmailProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>You've been invited to join {siteName}</Preview>
    <Body style={main}>
      <Container style={container}>
        <Text style={eyebrow}>TEAM INVITATION</Text>
        <Heading style={h1}>You've been invited</Heading>
        <Text style={text}>
          You've been invited to join{' '}
          <Link href={siteUrl} style={link}><strong>{siteName}</strong></Link>{' '}
          — convert HTG to USDC, send payouts, and manage your treasury in
          minutes.
        </Text>
        <Button style={button} href={confirmationUrl}>Accept invitation</Button>
        <Text style={footer}>
          If you weren't expecting this invitation, you can safely ignore this
          email. · Theo · Trust is the Original Currency.
        </Text>
      </Container>
    </Body>
  </Html>
)

export default InviteEmail

const main = { backgroundColor: '#ffffff', fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }
const container = { padding: '32px 28px', maxWidth: '520px' }
const eyebrow = { fontSize: '11px', fontWeight: 700 as const, letterSpacing: '0.18em', color: '#08B5E5', textTransform: 'uppercase' as const, margin: '0 0 12px' }
const h1 = { fontSize: '28px', fontWeight: 800 as const, letterSpacing: '-0.02em', color: '#1A1A2E', margin: '0 0 20px' }
const text = { fontSize: '15px', color: '#6B6B8A', lineHeight: '1.6', margin: '0 0 24px' }
const link = { color: '#33359A', textDecoration: 'underline' }
const button = { backgroundColor: '#33359A', color: '#ffffff', fontSize: '15px', fontWeight: 600 as const, borderRadius: '10px', padding: '14px 24px', textDecoration: 'none', display: 'inline-block' }
const footer = { fontSize: '12px', color: '#6B6B8A', margin: '32px 0 0', borderTop: '1px solid #EAEAF2', paddingTop: '20px' }
