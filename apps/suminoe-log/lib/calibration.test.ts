/**
 * 較正データの読み取りのテスト。
 *
 * ここで守りたいのは1点だけ。**その型の実測が無いときに、それらしい数字を当てはめない。**
 * 買い目カードに出す数字なので、近い別物を混ぜたら意味が変わる。
 */

import assert from 'node:assert/strict';

import { describe, it } from 'vitest';

import { findSimulation, type Calibration } from './calibration';

const CALIBRATION: Calibration = {
  schemaVersion: 1,
  generatedAt: '2026-08-08T23:57:17.419Z',
  days: 62,
  races: 743,
  temperature: 2,
  placeTemperature: 3,
  logLoss: 1.32,
  baselineLogLoss: 1.7918,
  favouriteHitRate: 0.533,
  trifectaRatio: 1.06,
  simulations: [
    { label: '3連単 上位6点', races: 743, hits: 217, hitRate: 0.2921, roi: 0.7468 },
    { label: '3連単 上位12点', races: 743, hits: 348, hitRate: 0.4684, roi: 0.7571 },
    { label: '3連複 上位3点', races: 740, hits: 326, hitRate: 0.4405, roi: 0.6916 },
    { label: '3連複 上位5点', races: 740, hits: 454, hitRate: 0.6135, roi: 0.712 },
  ],
};

describe('findSimulation', () => {
  it('堅実（3連複3点）の実測を引ける', () => {
    const found = findSimulation(CALIBRATION, '3連複', 3);
    assert.equal(found?.races, 740);
    assert.equal(found?.hitRate, 0.4405);
    assert.equal(found?.roi, 0.6916);
  });

  it('勝負（3連単6点）の実測を引ける', () => {
    const found = findSimulation(CALIBRATION, '3連単', 6);
    assert.equal(found?.hitRate, 0.2921);
    assert.equal(found?.roi, 0.7468);
  });

  it('検証していない点数には数字を当てはめない', () => {
    // 穴は4点だが、4点のシミュレーションは取っていない
    assert.equal(findSimulation(CALIBRATION, '3連単', 4), null);
    assert.equal(findSimulation(CALIBRATION, '3連複', 2), null);
  });

  it('該当が0点でも、近い点数で代用しない', () => {
    assert.equal(findSimulation(CALIBRATION, '3連単', 7), null, '6点で代用しない');
    assert.equal(findSimulation(CALIBRATION, '3連複', 4), null, '3点や5点で代用しない');
  });

  it('較正データが無ければ null', () => {
    assert.equal(findSimulation(null, '3連複', 3), null);
  });

  it('回収率はどれも控除率（75%）を超えていない', () => {
    // 超えていたら較正か集計を疑う。この前提が崩れたら気づけるようにしておく
    for (const entry of CALIBRATION.simulations) {
      assert.ok(entry.roi < 0.8, `${entry.label} の回収率が ${entry.roi} と高すぎる`);
    }
  });
});
