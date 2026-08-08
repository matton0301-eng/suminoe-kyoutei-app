/**
 * 開催日の扱いのテスト。
 *
 * 記録は日付ごとのキーに保存する。キーの作り方を間違えると
 * 前日の記録が混ざる、あるいは記録が読めなくなるので厳密に確かめる。
 */

import assert from 'node:assert/strict';

import { describe, it } from 'vitest';

import {
  CARD_KEY,
  RESULTS_KEY,
  compactDate,
  draftKey,
  formatDateLabel,
  formatDateSlash,
  isIsoDate,
  logsKey,
  todayIso,
} from './raceDate';

describe('isIsoDate', () => {
  it('YYYY-MM-DD だけを受け付ける', () => {
    assert.equal(isIsoDate('2026-08-09'), true);
    assert.equal(isIsoDate('2026-8-9'), false);
    assert.equal(isIsoDate('20260809'), false);
    assert.equal(isIsoDate(''), false);
    assert.equal(isIsoDate('2026-08-09T00:00'), false);
  });
});

describe('todayIso', () => {
  it('端末の日付を YYYY-MM-DD で返す', () => {
    assert.equal(todayIso(new Date(2026, 7, 9)), '2026-08-09');
    assert.equal(todayIso(new Date(2026, 0, 1)), '2026-01-01');
    assert.equal(todayIso(new Date(2026, 11, 31)), '2026-12-31');
  });

  it('月と日を0埋めする', () => {
    assert.equal(todayIso(new Date(2026, 2, 5)), '2026-03-05');
  });
});

describe('formatDateLabel', () => {
  it('曜日つきの短い表記にする', () => {
    // 2026-08-09 は日曜、2026-08-07 は金曜
    assert.equal(formatDateLabel('2026-08-09'), '8/9(日)');
    assert.equal(formatDateLabel('2026-08-07'), '8/7(金)');
    assert.equal(formatDateLabel('2026-01-01'), '1/1(木)');
  });

  it('読めない値はそのまま返す', () => {
    assert.equal(formatDateLabel('不明'), '不明');
    assert.equal(formatDateLabel(''), '');
  });
});

describe('formatDateSlash', () => {
  it('書き出しの見出し用の表記にする', () => {
    assert.equal(formatDateSlash('2026-08-09'), '2026/8/9');
    assert.equal(formatDateSlash('2026-12-31'), '2026/12/31');
  });
});

describe('保存キー', () => {
  it('記録と下書きは開催日ごとに分かれる', () => {
    assert.equal(logsKey('2026-08-09'), 'suminoe-log-20260809');
    assert.equal(draftKey('2026-08-09'), 'suminoe-draft-20260809');
    assert.notEqual(logsKey('2026-08-07'), logsKey('2026-08-09'));
    assert.notEqual(draftKey('2026-08-07'), draftKey('2026-08-09'));
  });

  it('記録と下書きのキーは衝突しない', () => {
    assert.notEqual(logsKey('2026-08-09'), draftKey('2026-08-09'));
  });

  it('出走表と結果は日付を含めない（1件だけ持つため）', () => {
    assert.equal(CARD_KEY, 'suminoe-racecard');
    assert.equal(RESULTS_KEY, 'suminoe-results');
    // 日付付きキーと前方一致で衝突しないこと（誤って一括削除しないため）
    assert.ok(!logsKey('2026-08-09').startsWith(CARD_KEY));
    assert.ok(!draftKey('2026-08-09').startsWith(CARD_KEY));
  });

  it('compactDate はハイフンを取る', () => {
    assert.equal(compactDate('2026-08-09'), '20260809');
    // 読めない値は壊さずそのまま
    assert.equal(compactDate('不明'), '不明');
  });
});
