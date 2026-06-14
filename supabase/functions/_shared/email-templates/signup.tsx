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

interface SignupEmailProps {
  siteName: string
  siteUrl: string
  recipient: string
  confirmationUrl: string
}

export const SignupEmail = ({
  siteName,
  siteUrl,
  recipient,
  confirmationUrl,
}: SignupEmailProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Confirm your email for {siteName}</Preview>
    <Body style={main}>
      <Container style={container}>
        <Text style={eyebrow}>WELCOME TO THEO</Text>
        <Heading style={h1}>Confirm your email</Heading>
        <Text style={text}>
          Thanks for creating a {siteName} account. Please confirm{' '}
          <Link href={`mailto:${recipient}`} style={link}>{recipient}</Link>{' '}
          to activate your business account.
        </Text>
        <Button style={button} href={confirmationUrl}>Confirm email</Button>
        <Text style={footer}>
          If you didn't create an account at{' '}
          <Link href={siteUrl} style={link}>{siteName}</Link>, you can safely
          ignore this email. · Theo · Trust is the Original Currency.
        </Text>
      </Container>
    </Body>
  </Html>
)

export default SignupEmail

const main = { backgroundColor: '#ffffff', fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }
const container = { padding: '32px 28px', maxWidth: '520px' }
const eyebrow = { fontSize: '11px', fontWeight: 700 as const, letterSpacing: '0.18em', color: '#08B5E5', textTransform: 'uppercase' as const, margin: '0 0 12px' }
const h1 = { fontSize: '28px', fontWeight: 800 as const, letterSpacing: '-0.02em', color: '#1A1A2E', margin: '0 0 20px' }
const text = { fontSize: '15px', color: '#6B6B8A', lineHeight: '1.6', margin: '0 0 24px' }
const link = { color: '#33359A', textDecoration: 'underline' }
const button = { backgroundColor: '#33359A', color: '#ffffff', fontSize: '15px', fontWeight: 600 as const, borderRadius: '10px', padding: '14px 24px', textDecoration: 'none', display: 'inline-block' }
const footer = { fontSize: '12px', color: '#6B6B8A', margin: '32px 0 0', borderTop: '1px solid #EAEAF2', paddingTop: '20px' }
