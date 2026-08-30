import { z } from 'zod';
import { listResponseSchema, singleResponseSchema } from '../helpers';

/**
 * Mirrors models/forms/models.py::Form — empty placeholder in Python, so
 * items stay untyped.
 */
export const FormSchema = z.any();

export const FormsListResponseSchema = listResponseSchema(FormSchema);
export const FormResponseSchema = singleResponseSchema(FormSchema);
