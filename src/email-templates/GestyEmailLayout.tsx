import {
  Body,
  Container,
  Head,
  Html,
  Img,
  Preview,
  Section,
  Text,
} from "@react-email/components";
import type { ReactNode } from "react";
import { EMAIL_THEME } from "./theme";

const BRAND_NAME = "gesty.ai";

export type GestyEmailLayoutProps = {
  preview: string;
  children: ReactNode;
  /** URL absoluta del logo/mascota; si está vacío no se muestra la imagen */
  mascotImageUrl: string;
  footerText?: string;
};

/**
 * Layout de marca gesty.ai: la mascota es lo primero (centrada), luego la tarjeta con cabecera primary.
 */
export function GestyEmailLayout({
  preview,
  children,
  mascotImageUrl,
  footerText,
}: GestyEmailLayoutProps) {
  return (
    <Html lang="es">
      <Head />
      <Preview>{preview}</Preview>
      <Body
        style={{
          backgroundColor: EMAIL_THEME.background,
          margin: 0,
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
        }}
      >
        <Section style={{ padding: "28px 16px 12px", textAlign: "center" }}>
          {mascotImageUrl ? (
            <Img
              src={mascotImageUrl}
              alt={`Mascota ${BRAND_NAME}`}
              style={{
                display: "block",
                margin: "0 auto",
                border: 0,
                outline: "none",
                maxWidth: "160px",
                width: "auto",
                height: "auto",
              }}
            />
          ) : null}
        </Section>
        <Section style={{ padding: "0 16px 28px" }}>
          <Container
            style={{
              backgroundColor: EMAIL_THEME.cardBackground,
              borderRadius: "8px",
              border: `1px solid ${EMAIL_THEME.borderSubtle}`,
              maxWidth: "580px",
              margin: "0 auto",
              overflow: "hidden",
            }}
          >
            <Section
              style={{
                backgroundColor: EMAIL_THEME.primary,
                padding: "18px 24px",
                textAlign: "center",
              }}
            >
              <Text
                style={{
                  color: EMAIL_THEME.onPrimary,
                  margin: 0,
                  fontSize: "17px",
                  fontWeight: 600,
                  letterSpacing: "-0.02em",
                  lineHeight: "22px",
                }}
              >
                {BRAND_NAME}
              </Text>
            </Section>
            <Section style={{ padding: "28px 24px" }}>{children}</Section>
            {footerText ? (
              <Section
                style={{
                  borderTop: `1px solid ${EMAIL_THEME.borderSubtle}`,
                  padding: "14px 24px",
                  backgroundColor: EMAIL_THEME.background,
                }}
              >
                <Text
                  style={{
                    color: EMAIL_THEME.textMuted,
                    fontSize: "12px",
                    lineHeight: "18px",
                    margin: 0,
                    textAlign: "center",
                  }}
                >
                  {footerText}
                </Text>
              </Section>
            ) : null}
          </Container>
        </Section>
      </Body>
    </Html>
  );
}
