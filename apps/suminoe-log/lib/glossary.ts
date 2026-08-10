/**
 * 用語の説明。**競艇を知らない人が読める言葉にするための辞書。**
 *
 * 方針:
 *   - **用語を消さない。** 現地の電光掲示や実況で使われる言葉なので、
 *     アプリだけ別の呼び方にすると、かえって現地で通じなくなる。意味を足すだけにする
 *   - 1行で言い切る。読み飛ばせる長さでないと読まれない
 *   - **都合の悪いことを省かない。** 控除率や回収率の説明で「増える」と読める書き方をしない
 *
 * 表示は `components/Term.tsx`。押したときだけ説明が開く。
 */

export interface GlossaryEntry {
  /** 画面に出る言葉 */
  term: string;
  /** 1行の説明 */
  short: string;
  /** 必要なら補足。無ければ null */
  more?: string;
}

/**
 * 賭式。**当てやすい順に並べている。**
 * 素人がいちばん最初に迷うのがここで、7つの違いが分からないと1枚も買えない。
 */
export interface BetTypeGuide extends GlossaryEntry {
  key: string;
  /** 組み合わせの数。多いほど当たりにくい */
  combinations: number;
  /** やさしさ（1がいちばんやさしい） */
  ease: number;
}

export const BET_TYPE_GUIDE: readonly BetTypeGuide[] = [
  {
    key: 'win',
    term: '単勝',
    ease: 1,
    combinations: 6,
    short: '1着になる艇を1つだけ当てます',
    more: '6通りしかないので、いちばんやさしい。当たっても配当は小さめです',
  },
  {
    key: 'place',
    term: '複勝',
    ease: 2,
    combinations: 6,
    short: '選んだ艇が2着までに入れば当たりです',
    more: '当たりやすいぶん、配当は7賭式でいちばん小さくなります',
  },
  {
    key: 'wide',
    term: '拡連複',
    ease: 3,
    combinations: 15,
    short: '選んだ2艇がどちらも3着までに入れば当たりです',
    more: '順番は問いません。「ワイド」とも呼ばれます',
  },
  {
    key: 'quinella',
    term: '2連複',
    ease: 4,
    combinations: 15,
    short: '1着と2着の2艇を当てます。順番は問いません',
  },
  {
    key: 'trio',
    term: '3連複',
    ease: 5,
    combinations: 20,
    short: '1〜3着の3艇を当てます。順番は問いません',
    more: '順番を当てなくてよいので、3連単よりずっとやさしい',
  },
  {
    key: 'exacta',
    term: '2連単',
    ease: 6,
    combinations: 30,
    short: '1着と2着を、順番どおりに当てます',
  },
  {
    key: 'trifecta',
    term: '3連単',
    ease: 7,
    combinations: 120,
    short: '1〜3着を、順番どおりに当てます',
    more: '120通りあり、いちばん難しい。そのぶん配当は大きくなります',
  },
];

/** 用語 → 説明。画面に出る言葉だけを入れる（使わない語を増やさない） */
export const GLOSSARY: readonly GlossaryEntry[] = [
  // レースの見方
  {
    term: 'イン',
    short: 'いちばん内側のコース。住之江では1コースの艇が56%で1着になります',
    more: '内側が有利なのは、最初のターンを最短距離で回れるためです',
  },
  {
    term: '進入',
    short: 'スタート前に各艇がどのコースに入るか',
    more: '枠番どおりに入ることを「枠なり」といいます',
  },
  { term: '枠なり', short: '枠番どおりのコースに入ること。住之江ではほとんどがこれです' },
  {
    term: '軸',
    short: 'その買い目の中心にする艇。「この艇は来る」と見た1艇です',
  },
  {
    term: '見（ケン）',
    short: 'そのレースは買わずに見ること。「けん」と読みます',
    more: '買わない判断も立派な選択です。全レース買う必要はありません',
  },

  // 直前情報
  {
    term: '展示タイム',
    short: 'レース直前の試走で計った直線のタイム。小さいほど速い',
    more: '締切の10〜15分前に公開されます。艇とモーターの調子が出ます',
  },
  {
    term: 'ST',
    short: 'スタートのタイミング（秒）。小さいほど良く、マイナスはフライング',
    more: '競艇はスタート時刻が決まっていて、早すぎると失格になります',
  },
  { term: 'チルト', short: 'モーターの取り付け角度。上げると直線が伸び、旋回は鈍ります' },
  { term: '部品交換', short: 'その節で交換した部品。調子を上げようとしている印です' },

  // 成績の数字
  {
    term: '勝率',
    short: '着順を点数に換算した平均。8点満点に近いほど強い',
    more: '1着=10点ではなく、競艇独自の配点です。7.00を超えればトップ級',
  },
  { term: '当地勝率', short: 'その競艇場だけでの勝率。水面との相性が出ます' },
  { term: '全国勝率', short: '全国どこでも合わせた勝率' },
  { term: '2連率', short: '2着までに入った割合' },
  {
    term: 'モーター2連率',
    short: 'そのモーターを積んだ艇が2着までに入った割合',
    more: 'モーターは競艇場が持っていて抽選で割り当てられます。当たり外れがあります',
  },
  {
    term: '級別',
    short: '選手のランク。上から A1 → A2 → B1 → B2',
    more: 'A1は全選手の上位約2割です',
  },

  // 決まり手
  { term: '逃げ', short: '1号艇が先頭のまま押し切ること' },
  { term: 'まくり', short: '外の艇が全速で回って、内の艇を抜き去ること' },
  { term: '差し', short: '内側の空いたところを突いて前に出ること' },
  { term: 'まくり差し', short: '外から回りながら、内へ差し込むこと' },
  { term: '抜き', short: '直線で追い抜くこと' },

  // お金の話（**ここをいちばん正直に書く**）
  {
    term: 'オッズ',
    short: '当たったときに、賭けた額の何倍が戻るか',
    more: '2.5倍なら100円が250円になります。締切直前まで動きます',
  },
  {
    term: '的中率',
    short: 'その買い方で、何回に1回当たるか',
    more: '27%なら、およそ4回に1回です',
  },
  {
    term: '回収率',
    short: '賭けた額に対して、いくら戻ったか',
    more: '100%で増減なし。**過去743レースで試したときは75%でした**（1万円が7,500円）',
  },
  {
    term: '控除率',
    short: '賭けられたお金のうち、主催者が取る分。競艇は25%',
    more: '**つまり全員の合計では、賭けた額の75%しか戻りません。**長く買えば平均して減ります',
  },
  {
    term: '期待値',
    short: 'この予想が正しければ、賭けた額の何倍が戻るかの見立て',
    more: '**予想が正しい前提の数字です。**100%を超えても儲かる保証はありません',
  },
  {
    term: '払戻',
    short: '当たったときに戻ってくるお金。100円あたりの金額で発表されます',
  },

  // 開催
  { term: '節', short: '同じメンバーで続けて行う開催のまとまり。住之江は6日間が多い' },
  { term: '優勝戦', short: '節の最終日に行われる、その節の締めくくりのレース' },
];

const BY_TERM = new Map<string, GlossaryEntry>([
  ...GLOSSARY.map((entry) => [entry.term, entry] as const),
  ...BET_TYPE_GUIDE.map((entry) => [entry.term, entry as GlossaryEntry] as const),
]);

/** その言葉の説明。無ければ null（それらしい説明を作らない） */
export function explain(term: string): GlossaryEntry | null {
  return BY_TERM.get(term) ?? null;
}

/** 賭式の案内。当てやすい順 */
export function betTypeGuide(key: string): BetTypeGuide | null {
  return BET_TYPE_GUIDE.find((entry) => entry.key === key) ?? null;
}

/**
 * 回収率を、素人にも意味が分かる言い方にする。
 *
 * 「170%」だけでは儲かると読める。**賭けた額に対していくら戻る見立てか**を書く。
 */
export function describeRecovery(rate: number, stakeYen: number): string {
  const back = Math.round((stakeYen * rate) / 100);
  return `${stakeYen.toLocaleString('ja-JP')}円ぶん買うと、平均で約${back.toLocaleString('ja-JP')}円戻る見立てです`;
}
