import { z } from 'zod';
import { letterSchema } from './letter-schema';

export const baseAnswerSchema = z.object({
  questionId: z.string().min(1),
  prompt: z.string().min(1),
  answer: z.string().min(1),
});

export const followupQuestionSchema = z.object({
  id: z.string().min(1),
  prompt: z.string().min(1),
});

export const followupAnswerSchema = z.object({
  questionId: z.string().min(1),
  answer: z.string().min(1),
});

export const generateFollowupsRequestSchema = z.object({
  issueSummary: z.string().min(1),
  baseAnswers: z.array(baseAnswerSchema).min(1).max(10),
});

export const generateFollowupsResponseSchema = z.object({
  questions: z.array(followupQuestionSchema).max(5),
});

export const researchPromptRequestSchema = z.object({
  issueSummary: z.string().min(1),
  baseAnswers: z.array(baseAnswerSchema).min(1).max(10),
  followupAnswers: z.array(followupAnswerSchema).max(5),
  tone: z.string().optional(),
});

export const researchPromptResponseSchema = z.object({
  prompt: z.string().min(1),
});

export const deepResearchRequestSchema = z.object({
  issueSummary: z.string().min(1),
  baseAnswers: z.array(baseAnswerSchema).min(1).max(10),
  followupAnswers: z.array(followupAnswerSchema).max(5),
  tone: z.string().optional(),
  researchPrompt: z.string().min(1),
});

export const deepResearchResponseSchema = z.object({
  jobId: z.string().min(1),
  status: z.enum(['queued', 'in_progress', 'completed', 'failed']),
  message: z.string(),
  credits: z.number().int().nonnegative(),
});

export const composeLetterRequestSchema = z.object({
  jobId: z.string().min(1),
  issueSummary: z.string().min(1),
  baseAnswers: z.array(baseAnswerSchema).min(1).max(10),
  followupAnswers: z.array(followupAnswerSchema).max(5),
  tone: z.string().optional(),
  researchSummary: z.string().min(1),
  userName: z.string().optional(),
  userAddressHtml: z.string().optional(),
  mpName: z.string().optional(),
  constituency: z.string().optional(),
});

export const composeLetterResponseSchema = z.object({
  letter: letterSchema,
});

export type BaseAnswer = z.infer<typeof baseAnswerSchema>;
export type FollowupQuestion = z.infer<typeof followupQuestionSchema>;
export type FollowupAnswer = z.infer<typeof followupAnswerSchema>;
export type GenerateFollowupsRequest = z.infer<
  typeof generateFollowupsRequestSchema
>;
export type GenerateFollowupsResponse = z.infer<
  typeof generateFollowupsResponseSchema
>;
export type ResearchPromptRequest = z.infer<typeof researchPromptRequestSchema>;
export type ResearchPromptResponse = z.infer<
  typeof researchPromptResponseSchema
>;
export type DeepResearchRequest = z.infer<typeof deepResearchRequestSchema>;
export type DeepResearchResponse = z.infer<typeof deepResearchResponseSchema>;
export type ComposeLetterRequest = z.infer<typeof composeLetterRequestSchema>;
export type ComposeLetterResponse = z.infer<typeof composeLetterResponseSchema>;
