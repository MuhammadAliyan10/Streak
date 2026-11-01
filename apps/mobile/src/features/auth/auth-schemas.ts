import { z } from 'zod';

const emailValue = z
  .string()
  .trim()
  .min(1, 'Enter your email address.')
  .email('Enter a valid email address.')
  .max(254);
const passwordValue = z
  .string()
  .min(12, 'Use at least 12 characters.')
  .max(128, 'Use no more than 128 characters.');

export const signInSchema = z.object({ email: emailValue, password: passwordValue });
export const signUpSchema = z
  .object({
    fullName: z
      .string()
      .trim()
      .min(2, 'Enter at least 2 characters.')
      .max(100, 'Use no more than 100 characters.'),
    email: emailValue,
    password: passwordValue,
    confirmPassword: z.string().min(1, 'Confirm your password.'),
  })
  .superRefine((value, context) => {
    if (value.password !== value.confirmPassword)
      context.addIssue({
        code: 'custom',
        path: ['confirmPassword'],
        message: 'Passwords do not match.',
      });
  });

export type SignInInput = z.infer<typeof signInSchema>;
export type SignUpInput = z.infer<typeof signUpSchema>;
