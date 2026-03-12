import { comparePassword, hashPassword } from './hash.util';

describe('hashPassword', () => {
  it('should return a bcrypt hash that starts with $2b$', async () => {
    const hash = await hashPassword('secret123');
    expect(hash).toMatch(/^\$2b\$/);
  });

  it('should produce a different hash each call (salted)', async () => {
    const hash1 = await hashPassword('secret123');
    const hash2 = await hashPassword('secret123');
    expect(hash1).not.toBe(hash2);
  });

  it('should use salt rounds 12', async () => {
    const hash = await hashPassword('secret123');
    // bcrypt hash format: $2b$<rounds>$...
    const rounds = parseInt(hash.split('$')[2], 10);
    expect(rounds).toBe(12);
  });
});

describe('comparePassword', () => {
  it('should return true for a correct password', async () => {
    const hash = await hashPassword('mypassword');
    expect(await comparePassword('mypassword', hash)).toBe(true);
  });

  it('should return false for an incorrect password', async () => {
    const hash = await hashPassword('mypassword');
    expect(await comparePassword('wrongpassword', hash)).toBe(false);
  });

  it('should return false for an empty string against a real hash', async () => {
    const hash = await hashPassword('mypassword');
    expect(await comparePassword('', hash)).toBe(false);
  });
});
