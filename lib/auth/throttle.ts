import { prisma } from "@/lib/prisma";

// Ograniczanie zgadywania hasła. Liczniki są w bazie, bo funkcje serverless nie współdzielą pamięci.
const IP_WINDOW_MIN = 15;
const IP_MAX_FAILURES = 5; // z jednego adresu IP w oknie 15 min
const GLOBAL_WINDOW_MIN = 60;
const GLOBAL_MAX_FAILURES = 30; // łącznie, na wypadek ataku z wielu adresów
const RETENTION_DAYS = 30;

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000);

export async function isLocked(ip: string): Promise<boolean> {
  const [perIp, global] = await Promise.all([
    prisma.loginAttempt.count({ where: { ip, success: false, createdAt: { gte: minutesAgo(IP_WINDOW_MIN) } } }),
    prisma.loginAttempt.count({ where: { success: false, createdAt: { gte: minutesAgo(GLOBAL_WINDOW_MIN) } } }),
  ]);
  return perIp >= IP_MAX_FAILURES || global >= GLOBAL_MAX_FAILURES;
}

export async function recordAttempt(ip: string, success: boolean): Promise<void> {
  await prisma.loginAttempt.create({ data: { ip, success } });
  // udane logowanie zeruje licznik błędów tego adresu; stare wpisy sprzątamy przy okazji
  if (success) await prisma.loginAttempt.deleteMany({ where: { ip, success: false } });
  await prisma.loginAttempt.deleteMany({ where: { createdAt: { lt: minutesAgo(RETENTION_DAYS * 24 * 60) } } });
}
