/// <reference types="npm:@types/react@18.3.1" />

import * as React from 'npm:react@18.3.1'

import {
  Body,
  Container,
  Head,
  Heading,
  Html,
  Preview,
  Section,
  Text,
} from 'npm:@react-email/components@0.0.22'

interface ReauthenticationEmailProps {
  token: string
}

export const ReauthenticationEmail = ({ token }: ReauthenticationEmailProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Your Theo verification code</Preview>
    <Body style={main}>
      <Container style={container}>
        <Text style={eyebrow}>IDENTITY CHECK</Text>
        <Heading style={h1}>Confirm it's you</Heading>
        <Text style={text}>Use this code to confirm your identity:</Text>
        <Section style={codeBox}>
          <Text style={codeText}>{token}</Text>
        </Section>
        <Text style={footer}>
          This code expires shortly. If you didn't request it, you can safely
          ignore this email. · Theo · Trust is the Original Currency.
        </Text>
      </Container>
    </Body>
  </Html>
)

export default ReauthenticationEmail

const main = { backgroundColor: '#ffffff', fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }
const container = { padding: '32px 28px', maxWidth: '520px' }
const eyebrow = { fontSize: '11px', fontWeight: 700 as const, letterSpacing: '0.18em', color: '#08B5E5', textTransform: 'uppercase' as const, margin: '0 0 12px' }
const h1 = { fontSize: '28px', fontWeight: 800 as const, letterSpacing: '-0.02em', color: '#1A1A2E', margin: '0 0 20px' }
const text = { fontSize: '15px', color: '#6B6B8A', lineHeight: '1.6', margin: '0 0 24px' }
const codeBox = { backgroundColor: '#EEF0FB', borderRadius: '12px', padding: '24px', textAlign: 'center' as const, margin: '8px 0 28px' }
const codeText = { fontSize: '36px', fontWeight: 700 as const, letterSpacing: '0.4em', color: '#33359A', margin: 0, fontFamily: "'SF Mono', Menlo, Consolas, monospace" }
const footer = { fontSize: '12px', color: '#6B6B8A', margin: '32px 0 0', borderTop: '1px solid #EAEAF2', paddingTop: '20px' }
