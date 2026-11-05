import { hash, verify } from '@node-rs/argon2';

// argon2id with OWASP-recommended parameters (19 MiB, t=2, p=1)
const OPTS = { memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

export const hashPassword = (pw: string) => hash(pw, OPTS);
export const verifyPassword = async (hashStr: string | null | undefined, pw: string) => {
  if (!hashStr) return false;
  try {
    return await verify(hashStr, pw);
  } catch {
    return false;
  }
};

export function passwordProblems(pw: string): string | null {
  if (pw.length < 10) return 'Password must be at least 10 characters';
  if (pw.length > 200) return 'Password is too long';
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return 'Password must contain letters and numbers';
  return null;
}
