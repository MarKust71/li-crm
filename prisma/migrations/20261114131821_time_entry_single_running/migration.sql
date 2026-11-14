-- Najwyżej jedna trwająca sesja czasu pracy (endedAt IS NULL) naraz.
-- Indeks częściowy: wszystkie wiersze z endedAt IS NULL mają to samo wyrażenie (true), więc drugi taki wiersz
-- zostanie odrzucony przez bazę (także przy podwójnym kliknięciu "Start" albo dwóch kartach przeglądarki).
-- Prisma nie opisuje indeksów częściowych w schema.prisma.
CREATE UNIQUE INDEX "TimeEntry_single_running_idx" ON "TimeEntry" ((true)) WHERE "endedAt" IS NULL;
