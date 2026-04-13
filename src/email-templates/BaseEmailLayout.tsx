import {
  Body,
  Container,
  Head,
  Html,
  Preview,
  Section,
  Text,
} from "@react-email/components";
import type { ReactNode } from "react";
import { EMAIL_THEME } from "./theme";

export type BaseEmailLayoutProps = {
  preview: string;
  children: ReactNode;
  /** Título o marca en la franja superior (color primary) */
  headerTitle?: string;
  /** Pie opcional (por ejemplo aviso legal o nombre del negocio) */
  footerText?: string;
};

export function BaseEmailLayout({
  preview,
  children,
  headerTitle,
  footerText,
}: BaseEmailLayoutProps) {
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
        <Section style={{ padding: "24px 16px" }}>
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
                padding: headerTitle ? "20px 24px" : "14px 24px",
                textAlign: "center",
              }}
            >
              {headerTitle ? (
                <Text
                  style={{
                    color: EMAIL_THEME.onPrimary,
                    margin: 0,
                    fontSize: "18px",
                    fontWeight: 600,
                    lineHeight: "24px",
                  }}
                >
                  {headerTitle}
                </Text>
              ) : null}
            </Section>
            <Section style={{ padding: "32px 24px" }}>{children}</Section>
            {footerText ? (
              <Section
                style={{
                  borderTop: `1px solid ${EMAIL_THEME.borderSubtle}`,
                  padding: "16px 24px",
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
