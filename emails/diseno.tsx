// SISTEMA VISUAL DE LOS CORREOS (React Email).
//
// UNA sola fuente para todos los correos del sistema: antes cada plantilla repetía a mano el mismo HTML
// con estilos en línea (dos copias, el «default» y el «esqueleto», que ya habían empezado a divergir).
// Aquí se define una vez la tarjeta, el título, el botón y el pie; las plantillas solo cuentan QUÉ dicen.
//
// Un correo no puede usar variables CSS ni los tokens `brand-*` de la app (los clientes de correo no los
// entienden), por eso los colores viven aquí como constantes. Son la ÚNICA fuente de color de los correos:
// cambiar uno cambia todos.
//
// Los textos con {{variables}} se escriben tal cual: el generador (scripts/build-emails.tsx) renderiza el
// HTML con los marcadores intactos y en tiempo de envío se sustituyen (lib/email/templates.ts). Esta
// carpeta NO se empaqueta en la app: solo genera lib/email/plantillas.generated.ts.
import * as React from 'react'
import { Body, Button, Container, Head, Hr, Html, Preview, Section, Text } from '@react-email/components'

export const COLOR = {
  fondo: '#f4f4f5',
  tarjeta: '#ffffff',
  borde: '#e4e4e7',
  texto: '#18181b',
  titulo: '#09090b',
  cuerpo: '#52525b',
  suave: '#a1a1aa',
  enlace: '#71717a',
  caja: '#f9fafb',
  /** Acento de los correos de acceso y de alumnos. */
  acento: '#7c3aed',
  /** Botón neutro (contratos). */
  oscuro: '#18181b',
} as const

const FUENTE = "-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"

export function Correo({ preview, pie, children }: { preview: string; pie?: string; children: React.ReactNode }) {
  return (
    <Html lang="es">
      <Head />
      <Preview>{preview}</Preview>
      <Body style={{ margin: 0, background: COLOR.fondo, fontFamily: FUENTE, color: COLOR.texto }}>
        <Container style={{ maxWidth: 560, margin: '0 auto', padding: '32px 16px' }}>
          <Section
            style={{
              background: COLOR.tarjeta,
              border: `1px solid ${COLOR.borde}`,
              borderRadius: 14,
              padding: 32,
            }}
          >
            {children}
          </Section>
          {pie ? (
            <Text style={{ textAlign: 'center', fontSize: 11, color: COLOR.suave, marginTop: 16 }}>{pie}</Text>
          ) : null}
        </Container>
      </Body>
    </Html>
  )
}

export function Cabecera({ subtitulo, aire = 24 }: { subtitulo: string; aire?: number }) {
  return (
    <>
      <Text style={{ margin: '0 0 4px', fontSize: 20, fontWeight: 700, color: COLOR.titulo }}>{'{{empresa}}'}</Text>
      <Text style={{ margin: `0 0 ${aire}px`, fontSize: 12, color: COLOR.suave }}>{subtitulo}</Text>
    </>
  )
}

export function Parrafo({ children }: { children: React.ReactNode }) {
  return <Text style={{ fontSize: 15, lineHeight: '1.6' }}>{children}</Text>
}

export function Destacado({ children }: { children: React.ReactNode }) {
  return <Text style={{ fontSize: 16, lineHeight: '1.6', fontWeight: 600, color: COLOR.acento }}>{children}</Text>
}

export function Boton({
  href = '{{enlace}}',
  color = COLOR.oscuro,
  children,
}: {
  href?: string
  color?: string
  children: React.ReactNode
}) {
  return (
    <Section style={{ textAlign: 'center', margin: '28px 0' }}>
      <Button
        href={href}
        style={{
          background: color,
          color: '#ffffff',
          textDecoration: 'none',
          padding: '13px 28px',
          borderRadius: 10,
          fontSize: 15,
          fontWeight: 600,
          display: 'inline-block',
        }}
      >
        {children}
      </Button>
    </Section>
  )
}

export function EnlaceAlternativo({ color = COLOR.acento }: { color?: string }) {
  return (
    <Text style={{ fontSize: 12, color: COLOR.enlace, lineHeight: '1.6' }}>
      Si el botón no funciona, copia y pega este enlace en tu navegador:
      <br />
      <span style={{ color, wordBreak: 'break-all' }}>{'{{enlace}}'}</span>
    </Text>
  )
}

export function Firma() {
  return (
    <>
      <Hr style={{ border: 'none', borderTop: `1px solid ${COLOR.borde}`, margin: '24px 0' }} />
      <Text style={{ fontSize: 13, color: COLOR.cuerpo, lineHeight: '1.6', whiteSpace: 'pre-line' }}>
        {'{{firma}}'}
      </Text>
    </>
  )
}
