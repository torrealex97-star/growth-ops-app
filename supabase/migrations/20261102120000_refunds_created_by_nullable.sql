-- refunds.created_by NOT NULL rompía la absorción automática de reservas reembolsadas en Stripe
-- (lib/finance/reservationRefundSync.ts inserta created_by = NULL a propósito: "devolución sin actor
-- humano"). El insert fallaba con 23502, la función lanzaba y la reserva seguía contando como cash.
-- Medido en producción 2-nov-2026: 2 reservas de 50 € devueltas en Stripe sin fila en `refunds`.
-- Cambio mínimo y reversible: la columna admite NULL; la FK a users se mantiene.
alter table public.refunds alter column created_by drop not null;
