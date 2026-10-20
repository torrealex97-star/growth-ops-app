// LAS PLANTILLAS DE CORREO DEL SISTEMA: qué dice cada una. El aspecto está en ./diseno.tsx.
//
// Cada plantilla puede tener VARIANTES para lo opcional (un botón sin enlace, una tarea sin descripción):
// el HTML se genera una vez por variante y en el envío se elige la que corresponde. Así no hace falta
// lógica condicional dentro del HTML ni dejar huecos vacíos.
//
// Los textos son EXACTAMENTE los que ya se enviaban: este cambio unifica el diseño, no la redacción.
import * as React from 'react'
import { Section, Text } from '@react-email/components'
import { Boton, Cabecera, COLOR, Correo, Destacado, EnlaceAlternativo, Firma, Parrafo } from './diseno'

export type VarianteCorreo = { clave: string; elemento: React.ReactElement }

const PIE_ENLACE_PERSONAL = 'Este enlace es personal y caduca. Si no esperabas este correo, ignóralo.'
const PIE_ESIGN = 'Firma electrónica simple (eIDAS). Este enlace es personal, no lo compartas.'
const PIE_COPIA = 'Firma electrónica simple (eIDAS). Conserva esta copia.'

const Invite = () => (
  <Correo preview="Crea tu contraseña para acceder al panel" pie={PIE_ENLACE_PERSONAL}>
    <Cabecera subtitulo="Acceso al panel del equipo" />
    <Parrafo>{'Hola {{nombre}},'}</Parrafo>
    <Parrafo>
      {'Te damos acceso al panel de {{empresa}}. Para entrar, primero '}
      <b>crea tu contraseña</b>
      {' pulsando el botón:'}
    </Parrafo>
    <Boton color={COLOR.acento}>Crear mi contraseña</Boton>
    <EnlaceAlternativo />
    <Firma />
  </Correo>
)

const Recovery = () => (
  <Correo preview="Restablece tu contraseña">
    <Cabecera subtitulo="Restablecer contraseña" />
    <Parrafo>Has solicitado restablecer tu contraseña. Pulsa el botón para crear una nueva:</Parrafo>
    <Boton color={COLOR.acento}>Crear nueva contraseña</Boton>
    <EnlaceAlternativo />
    <Text style={{ fontSize: 12, color: COLOR.suave, lineHeight: '1.6', marginTop: 16 }}>
      Si no fuiste tú, ignora este correo; tu contraseña no cambiará.
    </Text>
  </Correo>
)

const Contract = () => (
  <Correo preview="Tienes un contrato listo para firmar" pie={PIE_ESIGN}>
    <Cabecera subtitulo="Contrato para firmar" />
    <Parrafo>{'Hola {{nombre}},'}</Parrafo>
    <Parrafo>
      Tienes un contrato listo para revisar y firmar. Podrás completar tus datos (DNI, dirección…) directamente en la
      página de firma.
    </Parrafo>
    <Boton>Revisar y firmar contrato</Boton>
    <EnlaceAlternativo color={COLOR.acento} />
    <Firma />
  </Correo>
)

const ContractSigned = ({ conBoton }: { conBoton: boolean }) => (
  <Correo preview="Copia de tu contrato firmado" pie={PIE_COPIA}>
    <Cabecera subtitulo="Contrato firmado — copia" />
    <Parrafo>{'Hola {{nombre}},'}</Parrafo>
    <Parrafo>
      {'Tu contrato ha quedado '}
      <b>firmado correctamente</b>
      {'. Adjuntamos una copia en PDF para tus registros.'}
    </Parrafo>
    {conBoton ? <Boton href="{{enlace_pdf}}">Descargar contrato firmado</Boton> : null}
    <Firma />
  </Correo>
)

const StudentContract = () => (
  <Correo preview="Acepta tus condiciones y recibe tus accesos" pie={PIE_ESIGN}>
    <Cabecera subtitulo="Bienvenido a la Academia" aire={20} />
    <Destacado>{'{{bienvenida}}'}</Destacado>
    <Parrafo>
      {
        'Hola {{nombre}}, pulsa el botón para revisar y aceptar las condiciones. En cuanto aceptes, recibirás tus accesos.'
      }
    </Parrafo>
    <Boton color={COLOR.acento}>Aceptar condiciones y entrar</Boton>
    <EnlaceAlternativo />
  </Correo>
)

const StudentOnboarding = () => (
  <Correo preview="Tus accesos están listos">
    <Cabecera subtitulo="Tus accesos están listos 🚀" aire={20} />
    <Destacado>{'¡Ya eres un Winner, {{nombre}}!'}</Destacado>
    <Parrafo>
      Hemos activado tus accesos a la Academia. Sigue el paso a paso de onboarding para empezar hoy mismo: ahí
      encontrarás cómo entrar a la plataforma, el vídeo de inicio y todo lo que necesitas.
    </Parrafo>
    <Boton color={COLOR.acento}>Ver mis accesos y empezar</Boton>
    <EnlaceAlternativo />
    <Firma />
  </Correo>
)

const TaskAssigned = ({ conDescripcion, conMeta }: { conDescripcion: boolean; conMeta: boolean }) => (
  <Correo preview="Tienes una tarea nueva">
    <Cabecera subtitulo="Nueva tarea asignada" aire={20} />
    <Parrafo>{'Hola {{nombre}}, tienes una tarea nueva por realizar:'}</Parrafo>
    <Section
      style={{
        background: COLOR.caja,
        border: `1px solid ${COLOR.borde}`,
        borderRadius: 10,
        padding: 16,
        margin: '16px 0',
      }}
    >
      <Text style={{ fontSize: 15, fontWeight: 600, margin: '0 0 6px' }}>{'{{tarea}}'}</Text>
      {conDescripcion ? (
        <Text
          style={{ fontSize: 13, color: COLOR.cuerpo, lineHeight: '1.5', margin: '0 0 6px', whiteSpace: 'pre-line' }}
        >
          {'{{descripcion}}'}
        </Text>
      ) : null}
      {conMeta ? <Text style={{ fontSize: 12, color: COLOR.suave, margin: 0 }}>{'{{meta}}'}</Text> : null}
    </Section>
    <Boton color={COLOR.acento}>Ver mis tareas</Boton>
  </Correo>
)

/**
 * Todas las variantes que se generan. La clave sin sufijo es la COMPLETA (la que ve el editor); las
 * demás quitan lo opcional. `templates.ts` elige según lo que llegue en el envío.
 */
export const PLANTILLAS: Record<string, React.ReactElement> = {
  invite: <Invite />,
  recovery: <Recovery />,
  contract: <Contract />,
  contract_signed: <ContractSigned conBoton />,
  'contract_signed:sin_enlace': <ContractSigned conBoton={false} />,
  student_contract: <StudentContract />,
  student_onboarding: <StudentOnboarding />,
  student_contract_signed: <ContractSigned conBoton />,
  'student_contract_signed:sin_enlace': <ContractSigned conBoton={false} />,
  task_assigned: <TaskAssigned conDescripcion conMeta />,
  'task_assigned:sin_descripcion': <TaskAssigned conDescripcion={false} conMeta />,
  'task_assigned:sin_meta': <TaskAssigned conDescripcion conMeta={false} />,
  'task_assigned:sin_descripcion_ni_meta': <TaskAssigned conDescripcion={false} conMeta={false} />,
}
