import assert from 'node:assert/strict'
import test from 'node:test'

import { buildVatExemptOrderBreakdown, vatOrderSummaryRows } from '../src/utils/pricing.js'

test('regular VAT-inclusive formula', () => {
  const breakdown = buildVatExemptOrderBreakdown({ subtotal: 637.5 })
  assert.equal(breakdown.baseAmount, 569.2)
  assert.equal(breakdown.vatAmount, 68.3)
  assert.equal(breakdown.totalAmount, 637.5)
  assert.deepEqual(vatOrderSummaryRows(breakdown).map(({ label, amount }) => ({ label, amount })), [
    { label: 'VATable Sale', amount: 569.2 },
    { label: '12% VAT', amount: 68.3 },
  ])
})

test('SC/PWD VAT-exempt formula', () => {
  const breakdown = buildVatExemptOrderBreakdown({ subtotal: 637.5, discountSubtotal: 337.5, discountType: 'Senior' })
  assert.equal(breakdown.regularBaseAmount, 267.86)
  assert.equal(breakdown.vatExemptSale, 301.34)
  assert.equal(breakdown.regularVatAmount, 32.14)
  assert.equal(breakdown.discountAmount, 60.27)
  assert.equal(breakdown.totalAmount, 541.07)
  assert.deepEqual(vatOrderSummaryRows(breakdown).map(({ label, amount }) => ({ label, amount })), [
    { label: 'VATable Sale', amount: 267.86 },
    { label: 'VAT-Exempt Sale', amount: 301.34 },
    { label: '12% VAT', amount: 32.14 },
    { label: 'SC/PWD discount', amount: -60.27 },
  ])
})

test('persisted VAT exemption and discount remain separate values', () => {
  const breakdown = buildVatExemptOrderBreakdown({
    subtotal: 637.5,
    discountSubtotal: 337.5,
    discountType: 'PWD',
    vatExemptAmount: 36.16,
    discountAmount: 60.27,
  })
  assert.equal(breakdown.vatExemptAmount, 36.16)
  assert.equal(breakdown.discountAmount, 60.27)
  assert.equal(breakdown.totalBenefitAmount, 96.43)
  assert.equal(breakdown.totalAmount, 541.07)
})
