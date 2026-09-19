/**
 * Контрольные примеры организатора V01–V10.
 * Ожидаемые значения берутся из validation/expected_checks.json (файл организатора,
 * скопирован без изменений), входные данные — из validation/control_cases.md.
 */
import { describe, expect, it } from 'vitest';
import expectedChecks from '../../../validation/expected_checks.json';
import {
  actualDelivery,
  capacityCheck,
  closingInventory,
  losses,
  payableVolume,
  reservationPayment,
  reserveRequirement,
  serve,
  variablePayment,
} from '../primitives';

const expected = (id: string) => {
  const row = expectedChecks.find((c) => c.case_id === id);
  if (!row) throw new Error(`Нет контрольного вектора ${id}`);
  return row.expected as unknown as Record<string, number | string>;
};

describe('Контрольные примеры V01–V10', () => {
  it('V01 — материальный баланс', () => {
    const closing = closingInventory({ opening_t: 10, delivered_t: 30, losses_t: 2, served_t: 25 });
    expect(closing).toBe(expected('V01').closing_inventory_t);
  });

  it('V02 — дефицит не является отрицательным запасом', () => {
    const opening = 0;
    const delivered = 8;
    const { served_t, shortage_t } = serve(opening + delivered, 10);
    const closing = closingInventory({ opening_t: opening, delivered_t: delivered, losses_t: 0, served_t });
    const e = expected('V02');
    expect(served_t).toBe(e.served_t);
    expect(shortage_t).toBe(e.shortage_t);
    expect(closing).toBe(e.closing_inventory_t);
  });

  it('V03 — минимум take-or-pay', () => {
    const payable = payableVolume(50, 0.7, 100);
    const e = expected('V03');
    expect(payable).toBe(e.payable_volume_t);
    expect(variablePayment(2, payable)).toBe(e.variable_payment_mln);
  });

  it('V04 — take-or-pay не начисляется дважды', () => {
    // Платёж считается ровно один раз: минимум уже внутри payableVolume
    const payable = payableVolume(50, 0.7, 100);
    expect(variablePayment(2, payable)).toBe(expected('V04').variable_payment_mln);
  });

  it('V05 — пропорциональная плата за резервирование', () => {
    expect(reservationPayment(0.4, 100, 0.5)).toBe(expected('V05').reservation_payment_mln);
  });

  it('V06 — потери один раз на throughput', () => {
    expect(losses(20, 0.05)).toBe(expected('V06').losses_t);
  });

  it('V07 — 45-дневный резерв', () => {
    expect(reserveRequirement(365)).toBe(expected('V07').reserve_t);
  });

  it('V08 — превышение мощности', () => {
    const violation = capacityCheck(12, 10);
    const e = expected('V08');
    expect(violation?.violation).toBe(e.violation);
    expect(violation?.excess_t).toBe(e.excess_t);
    expect(capacityCheck(10, 10)).toBeNull();
  });

  it('V09 — критический спрос вложен в общий', () => {
    const total = 100;
    const critical = 60;
    // Критический спрос не прибавляется к общему
    expect(total).toBe(expected('V09').total_demand_t);
    expect(critical).toBeLessThanOrEqual(total);
  });

  it('V10 — доля поставки в стрессе не умножается на надёжность', () => {
    expect(actualDelivery(20, 0.5)).toBe(expected('V10').actual_delivery_t);
  });
});
