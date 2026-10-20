// Esquema zod de la config, para validar lo que llega al servidor (importar JSON, guardar borrador,
// publicar). Pone topes a todo: es input de usuarios y acaba en jsonb.

import { z } from 'zod'
import { FIELD_TYPES, MAX_OPTIONS, MAX_QUESTIONS } from './types'

const id = z.string().regex(/^[a-zA-Z0-9_-]{1,40}$/, 'Identificador no válido')
const text = (max: number) => z.string().max(max)
const scalar = z.union([z.string().max(300), z.number(), z.boolean()])

const condition = z.object({
  questionId: z.string().regex(/^\$?[a-zA-Z0-9_-]{1,40}$/),
  op: z.enum(['equals', 'notEquals', 'in', 'notIn', 'contains', 'gt', 'gte', 'lt', 'lte', 'isAnswered', 'isEmpty']),
  value: z.union([scalar, z.array(scalar).max(50)]).optional(),
})
const group = z.object({ match: z.enum(['all', 'any']), conditions: z.array(condition).max(20) })

const semantic = z
  .string()
  .regex(/^(contact\.(name|email|phone)|rating|nps|teacher|module|class|qualification\.[a-z0-9_]{1,40})$/)

const question = z.object({
  id,
  type: z.enum(FIELD_TYPES),
  title: text(500),
  help: text(1000).optional(),
  required: z.boolean().optional(),
  placeholder: text(200).optional(),
  icon: text(40).optional(),
  imageUrl: z.string().url().max(2000).startsWith('https://').optional(),
  options: z
    .array(
      z.object({
        value: text(120),
        label: text(200),
        icon: text(40).optional(),
        imageUrl: z.string().url().max(2000).startsWith('https://').optional(),
      })
    )
    .max(MAX_OPTIONS)
    .optional(),
  allowOther: z.boolean().optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  minLength: z.number().int().min(0).max(5000).optional(),
  maxLength: z.number().int().min(1).max(5000).optional(),
  pattern: text(200).optional(),
  patternMessage: text(200).optional(),
  scaleMax: z.number().int().min(2).max(10).optional(),
  scaleLabels: z.object({ min: text(60).optional(), max: text(60).optional() }).optional(),
  semantic: semantic.optional(),
  showIf: group.optional(),
  hiddenKey: z
    .string()
    .regex(/^[a-zA-Z0-9_]{1,40}$/)
    .optional(),
  defaultValue: text(500).optional(),
})

const logicRule = z.object({
  id,
  from: id,
  when: group,
  then: z.union([
    z.object({ type: z.literal('jump'), target: id }),
    z.object({ type: z.literal('end'), endingId: id }),
  ]),
})

const ending = z.object({
  id,
  title: text(300),
  message: text(2000).optional(),
  ctaLabel: text(80).optional(),
  ctaUrl: text(2000).optional(),
  redirectUrl: text(2000).optional(),
  redirectDelayMs: z.number().int().min(0).max(30000).optional(),
  when: group.optional(),
  isDefault: z.boolean().optional(),
})

export const formConfigSchema = z.object({
  schemaVersion: z.literal(1),
  welcome: z
    .object({
      kicker: text(80).optional(),
      title: text(300),
      subtitle: text(600).optional(),
      cta: text(60),
      estimatedTime: text(40).optional(),
    })
    .optional(),
  questions: z.array(question).max(MAX_QUESTIONS),
  logic: z.array(logicRule).max(200),
  endings: z.array(ending).min(1).max(20),
  scoring: z
    .object({
      enabled: z.boolean(),
      weights: z
        .array(
          z.object({
            questionId: id,
            value: text(120).optional(),
            in: z.array(text(120)).max(50).optional(),
            gte: z.number().min(-1e9).max(1e9).optional(),
            lte: z.number().min(-1e9).max(1e9).optional(),
            points: z.number().min(-100).max(100),
          })
        )
        .max(300),
      thresholds: z.object({ caliente: z.number().min(0).max(100), templado: z.number().min(0).max(100) }),
      tagPrefix: z
        .string()
        .regex(/^[a-z0-9_-]{1,40}$/)
        .optional(),
    })
    .optional(),
  abTest: z.object({ field: z.enum(['title', 'cta']), a: text(300), b: text(300) }).optional(),
  theme: z
    .object({
      mode: z.enum(['light', 'dark', 'auto']),
      logoUrl: z.string().url().max(2000).startsWith('https://').optional(),
      hideLogo: z.boolean().optional(),
      coverUrl: z.string().url().max(2000).startsWith('https://').optional(),
      accent: z
        .string()
        .regex(/^#[0-9a-fA-F]{6}$/)
        .optional(),
      background: z
        .string()
        .regex(/^#[0-9a-fA-F]{6}$/)
        .optional(),
      backgroundImageUrl: z.string().url().max(2000).startsWith('https://').optional(),
      font: z.enum(['sans', 'display', 'serif', 'mono']).optional(),
      radius: z.enum(['sm', 'md', 'lg', 'full']).optional(),
    })
    .optional(),
})

export type FormConfigInput = z.infer<typeof formConfigSchema>
