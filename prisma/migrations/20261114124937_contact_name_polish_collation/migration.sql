-- Sortowanie nazw po polsku niezależnie od kolacji bazy.
--
-- Kolacja bazy (en_US.utf8) nie nadaje się: lokalnie (glibc) traktuje Ł/Ć/Ż jak warianty L/C/Z,
-- a w produkcji (PostgreSQL na musl) w ogóle nie działa i sortuje po kodach znaków
-- (polskie litery na końcu, wielkie przed małymi). Kolacja ICU "pl-PL-x-icu" jest dostępna na obu
-- i daje polską kolejność. Jest deterministyczna, więc równość, ILIKE i unikalność działają jak dotąd.
--
-- Prisma nie opisuje kolacji kolumn w schema.prisma. Jeśli kiedyś migracja zmieni typ kolumny "name",
-- trzeba w niej ponownie podać COLLATE.
ALTER TABLE "Contact" ALTER COLUMN "name" TYPE TEXT COLLATE "pl-PL-x-icu";
