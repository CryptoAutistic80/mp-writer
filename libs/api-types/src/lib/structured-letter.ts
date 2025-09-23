import { z } from 'zod';

export const followUpQuestionSchema = z
  .object({
    id: z.string().min(1, 'id is required'),
    question: z.string().min(1, 'question is required'),
  })
  .strict();

export type FollowUpQuestion = z.infer<typeof followUpQuestionSchema>;

export const followUpContextItemSchema = z
  .object({
    id: z.string().min(1, 'id is required'),
    prompt: z.string().min(1, 'prompt is required'),
    answer: z.string().min(1, 'answer is required'),
  })
  .strict();

export type FollowUpContextItem = z.infer<typeof followUpContextItemSchema>;

export const generateFollowupsRequestSchema = z
  .object({
    issueSummary: z.string().min(1, 'issueSummary is required'),
    contextAnswers: z.array(followUpContextItemSchema).max(10).default([]),
    mpName: z.string().optional(),
    constituency: z.string().optional(),
  })
  .strict();

export type GenerateFollowupsRequest = z.infer<typeof generateFollowupsRequestSchema>;

export const generateFollowupsResponseSchema = z
  .object({
    followUps: z.array(followUpQuestionSchema).max(4),
  })
  .strict();

export type GenerateFollowupsResponse = z.infer<typeof generateFollowupsResponseSchema>;

export const referenceSchema = z
  .object({
    title: z.string().min(1, 'title is required'),
    source: z.string().min(1, 'source is required'),
    url: z.string().url('url must be valid'),
  })
  .strict();

export type LetterReference = z.infer<typeof referenceSchema>;

export const structuredLetterSchema = z
  .object({
    recipient: z
      .object({
        name: z.string().min(1, 'recipient.name is required'),
        constituency: z.string().optional(),
        addressLines: z.array(z.string().min(1)).max(5).default([]),
      })
      .strict(),
    sender: z
      .object({
        name: z.string().min(1, 'sender.name is required'),
        addressLines: z.array(z.string().min(1)).min(1).max(5),
      })
      .strict(),
    date: z.string().min(1, 'date is required'),
    tone: z.string().min(1).optional(),
    salutation: z.string().min(1, 'salutation is required'),
    body: z.array(z.string().min(1)).min(1),
    actions: z.array(z.string().min(1)).max(6),
    conclusion: z.string().min(1, 'conclusion is required'),
    closing: z
      .object({
        signOff: z.string().min(1, 'closing.signOff is required'),
        signature: z.string().min(1, 'closing.signature is required'),
      })
      .strict(),
    references: z.array(referenceSchema).max(3),
  })
  .strict();

export type StructuredLetter = z.infer<typeof structuredLetterSchema>;

export const transformLetterRequestSchema = z
  .object({
    letterHtml: z.string().min(1, 'letterHtml is required'),
    mpName: z.string().min(1, 'mpName is required'),
    constituency: z.string().optional(),
    senderName: z.string().min(1, 'senderName is required'),
    senderAddressLines: z.array(z.string().min(1)).min(1).max(5),
    tone: z.string().optional(),
    date: z.string().optional(),
  })
  .strict();

export type TransformLetterRequest = z.infer<typeof transformLetterRequestSchema>;

export const transformLetterResponseSchema = z
  .object({
    letter: structuredLetterSchema,
  })
  .strict();

export type TransformLetterResponse = z.infer<typeof transformLetterResponseSchema>;

export const structuredLetterJsonSchema = {
  name: 'structured_letter',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: [
      'recipient',
      'sender',
      'date',
      'salutation',
      'body',
      'actions',
      'conclusion',
      'closing',
      'references',
    ],
    properties: {
      recipient: {
        type: 'object',
        additionalProperties: false,
        required: ['name'],
        properties: {
          name: { type: 'string', minLength: 1 },
          constituency: { type: 'string' },
          addressLines: {
            type: 'array',
            items: { type: 'string', minLength: 1 },
            minItems: 0,
            maxItems: 5,
          },
        },
      },
      sender: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'addressLines'],
        properties: {
          name: { type: 'string', minLength: 1 },
          addressLines: {
            type: 'array',
            items: { type: 'string', minLength: 1 },
            minItems: 1,
            maxItems: 5,
          },
        },
      },
      date: { type: 'string', minLength: 1 },
      tone: { type: 'string', minLength: 1 },
      salutation: { type: 'string', minLength: 1 },
      body: {
        type: 'array',
        items: { type: 'string', minLength: 1 },
        minItems: 1,
      },
      actions: {
        type: 'array',
        items: { type: 'string', minLength: 1 },
        minItems: 0,
        maxItems: 6,
      },
      conclusion: { type: 'string', minLength: 1 },
      closing: {
        type: 'object',
        additionalProperties: false,
        required: ['signOff', 'signature'],
        properties: {
          signOff: { type: 'string', minLength: 1 },
          signature: { type: 'string', minLength: 1 },
        },
      },
      references: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['title', 'source', 'url'],
          properties: {
            title: { type: 'string', minLength: 1 },
            source: { type: 'string', minLength: 1 },
            url: { type: 'string', minLength: 1 },
          },
        },
        minItems: 0,
        maxItems: 3,
      },
    },
  },
} as const;

