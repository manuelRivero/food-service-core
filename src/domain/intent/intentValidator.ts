import { z } from 'zod';
import { formatZodIssues, truncateValue } from '../../utils/zodHelpers';
import { INTENT_ENUM_VALUES, mapUnknownIntents } from './intentNormalizer';

export const IntentEnumSchema = z.enum(INTENT_ENUM_VALUES);
export const IntentEntitiesSchema = z
  .object({
    product_name: z.string().optional(),
    quantity: z.number().optional(),
    modifiers: z.array(z.string()).optional(),
    size: z.string().optional()
  })
  .strict();

export const IntentResultSchema = z
  .object({
    intents: z.array(IntentEnumSchema).min(1),
    entities: IntentEntitiesSchema.optional(),
    confidence: z.number().min(0).max(1)
  })
  .strict();

export const LenientIntentResultSchema = z
  .object({
    intents: z.array(z.string()).min(1),
    entities: IntentEntitiesSchema.optional(),
    confidence: z.number().min(0).max(1)
  })
  .strict();

let validationFailedCount = 0;

export const getValidationFailedCount = (): number => validationFailedCount;

const logValidationFailure = (
  context: string,
  issues: z.ZodIssue[],
  content: string
): void => {
  validationFailedCount += 1;
  console.warn(
    `Intent validation failed (${context}): ${formatZodIssues(issues)} | content=${truncateValue(
      content
    )}`
  );
};

export const safeJsonParse = (value: string): unknown | null => {
  try {
    return JSON.parse(value) as unknown;
  } catch (error) {
    console.error('Intent classifier JSON parse error:', error);
    return null;
  }
};

export const extractJsonFromText = (value: string): string | null => {
  const match = value.match(/\{[\s\S]*\}/);
  return match ? match[0] : null;
};

export const parseIntentResult = (
  content: string
): z.infer<typeof IntentResultSchema> | null => {
  const trimmedContent = content.trim();
  if (!trimmedContent) {
    validationFailedCount += 1;
    console.warn('Intent classifier returned empty content');
    return null;
  }

  const candidates: string[] = [trimmedContent];
  const extracted = extractJsonFromText(trimmedContent);
  if (extracted && extracted !== trimmedContent) {
    candidates.push(extracted);
  }

  for (const candidate of candidates) {
    const parsed = safeJsonParse(candidate);
    if (!parsed) {
      continue;
    }

    const strictResult = IntentResultSchema.safeParse(parsed);
    if (strictResult.success) {
      return strictResult.data;
    }
    logValidationFailure('strict', strictResult.error.issues, candidate);

    const lenientResult = LenientIntentResultSchema.safeParse(parsed);
    if (lenientResult.success) {
      return {
        ...lenientResult.data,
        intents: mapUnknownIntents(lenientResult.data.intents)
      };
    }
    logValidationFailure('lenient', lenientResult.error.issues, candidate);
  }

  return null;
};

// NUEVO: Exportar para uso externo
export { INTENT_ENUM_VALUES };
