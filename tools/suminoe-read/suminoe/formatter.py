"""出力の整形（Markdown / CSV / chat貼り付け用 / アプリ取り込み用JSON）。"""

from __future__ import annotations

import csv
import io
import json

from .analyzer import MOTOR_PICK_MARGIN
from .baseline import FOOTNOTE
from .models import Program, Race, RaceAnalysis, Racer

WEEKDAY_JP = ("月", "火", "水", "木", "金", "土", "日")


def _date_label(date_iso: str) -> str:
    from datetime import date

    y, m, d = (int(v) for v in date_iso.split("-"))
    target = date(y, m, d)
    return f"{y}/{m}/{d}({WEEKDAY_JP[target.weekday()]})"


def _touchi_cell(racer: Racer) -> str:
    if racer.no_touchi_data:
        return "—(実績なし)"
    return f"{racer.touchi_shoritsu:.2f}"


def _touchi2_cell(racer: Racer) -> str:
    if racer.no_touchi_data:
        return "—"
    return f"{racer.touchi_2ritsu:.1f}%"


def _history_cell(facts) -> str:
    """選手の住之江実績を1セルに収める。母数を必ず出す。"""
    if facts is None or facts.runs == 0:
        return "—"
    if facts.win_rate is None:
        # 母数不足。走数だけを事実として出す
        return f"{facts.runs}走"
    return f"{facts.runs}走 1着{facts.win_rate:.0f}%"


#: 番組表のM2率と実測がこれ以上離れていたら注記を出す（ポイント）
MOTOR_GAP_PT = 8.0


def _motor_cell(racer: Racer, facts) -> str:
    """モーターの2連対率。番組表の値と、過去成績から数えた実測を併記する。

    番組表のM2率は公式が長期で計算した値だが走数が公開されていない。
    実測は母数がはっきりしている代わりに期間が短い。両方を並べて判断材料にする。
    """
    base = f"{racer.motor_2ritsu:.1f}%"
    if facts is None or facts.motor_niren_rate is None:
        return base
    return f"{base} / 実測{facts.motor_niren_rate:.0f}%({facts.motor_runs}走)"


def _motor_gap_notes(race: Race, facts: dict | None) -> list[str]:
    """番組表のM2率と実測が大きく離れている艇を挙げる。判定は変えず情報として出す。"""
    if not facts:
        return []
    notes = []
    for racer in race.racers:
        entry = facts.get(racer.teiban)
        if entry is None or entry.motor_niren_rate is None:
            continue
        gap = entry.motor_niren_rate - racer.motor_2ritsu
        if abs(gap) < MOTOR_GAP_PT:
            continue
        direction = "実測のほうが高い（上向き）" if gap > 0 else "実測のほうが低い（下向き）"
        notes.append(
            f"{racer.teiban}号艇のモーター{racer.motor_no}は番組表{racer.motor_2ritsu:.1f}%に対し"
            f"直近{entry.motor_runs}走の実測{entry.motor_niren_rate:.0f}%。{direction}"
        )
    return notes


def render_markdown(
    program: Program,
    analyses: tuple[RaceAnalysis, ...],
    motor_line: float | None,
    facts_by_race: dict[int, dict[int, object]] | None = None,
) -> str:
    """人が読む用の Markdown。先頭のサマリーだけで当日の方針が立つようにする。"""
    by_no = {a.race_no: a for a in analyses}
    out: list[str] = []

    out.append(f"# 住之江 {_date_label(program.date)} 出走表分析")
    out.append("")
    if program.title:
        out.append(f"**{program.title}**　{program.day_label}")
        out.append("")

    out.append("> このツールは勝つための予想ツールではありません。舟券の控除率は約25%あり、")
    out.append("> データ分析でそれを覆すことは想定していません。")
    out.append("> 目的は「根拠を持ってレースを見られること」です。買い目は定石の型の提示に留めています。")
    out.append("")

    # ---- サマリー ----
    out.append("## サマリー")
    out.append("")
    shobu = [n for n in sorted(by_no) if by_no[n].verdict == "勝負"]
    miokuri = [n for n in sorted(by_no) if by_no[n].verdict == "見送り"]
    hyojun = [n for n in sorted(by_no) if by_no[n].verdict == "標準"]
    out.append(f"- **勝負レース**: {_race_list(shobu)}")
    out.append(f"- **見送り推奨**: {_race_list(miokuri)}")
    out.append(f"- 標準: {_race_list(hyojun)}")

    picks: list[str] = []
    for race_no in sorted(by_no):
        for teiban, rate in by_no[race_no].motor_picks:
            picks.append(f"{race_no}R-{teiban}号艇({rate:.1f}%)")
    if motor_line is not None:
        line_note = f"（当日全{_boat_count(program)}艇の中央値+{MOTOR_PICK_MARGIN:.0f}pt = {motor_line:.1f}%以上）"
        out.append(f"- **モーター注目**{line_note}: {', '.join(picks) if picks else '該当なし'}")
    out.append("")

    if program.warnings:
        out.append("### ⚠ 取得・パースの警告")
        out.append("")
        for warning in program.warnings:
            out.append(f"- {warning}")
        out.append("")

    out.append("---")
    out.append("")

    # ---- レースごと ----
    for race in program.races:
        analysis = by_no.get(race.race_no)
        if analysis is None:
            continue
        facts = (facts_by_race or {}).get(race.race_no)
        out.extend(_render_race(race, analysis, facts))

    out.append("---")
    out.append("")
    out.append("### 指標の意味")
    out.append("")
    out.append("- **イン信頼度**: 1号艇が逃げ切れそうか（級別・当地勝率・モーター2連対率から3段階）")
    out.append("- **波乱リスク**: 3・4号艇の攻めが利きそうか（1号艇との勝率比較から3段階）")
    out.append(
        f"- **モーター注目**: 当日出走全艇のモーター2連対率の中央値+{MOTOR_PICK_MARGIN:.0f}pt以上の艇"
    )
    out.append("- **総合判定**: 勝負=イン信頼度高かつ波乱リスク低 / 見送り=イン信頼度低かつ波乱リスク高 / 標準=それ以外")
    out.append("")
    out.append(
        "住之江は枠なり進入がほぼ確定しているため（1枠→1コース100.0%）、枠番=進入コースとして扱っています。"
    )
    out.append("")
    return "\n".join(out)


def _boat_count(program: Program) -> int:
    return sum(len(race.racers) for race in program.races)


def _race_list(race_nos: list[int]) -> str:
    return ", ".join(f"{n}R" for n in race_nos) if race_nos else "なし"


def _render_race(race: Race, analysis: RaceAnalysis, facts: dict | None = None) -> list[str]:
    out: list[str] = []
    title = f"## {race.race_no}R {race.name}".rstrip()
    out.append(f"{title}　{race.distance_m}m　締切 {race.deadline}")
    out.append("")

    if not race.ok:
        out.append(f"**取得失敗**: {race.parse_error or '不明'}")
        out.append("")
        return out

    out.append(
        f"**総合判定：{analysis.verdict}**　イン信頼度={analysis.in_confidence} / "
        f"波乱リスク={analysis.upset_risk}"
    )
    out.append("")
    out.append(f"> {analysis.verdict_reason}")
    out.append(f"> イン: {analysis.in_reason}")
    out.append(f"> 波乱: {analysis.upset_reason}")
    out.append("")

    out.append(
        "| 枠 | 選手 | 級別 | 全国 | 当地 | 住之江実績 | M番号 | M2率（番組表/実測） | 今節 |"
    )
    out.append("|---|---|---|---|---|---|---|---|---|")
    for racer in race.racers:
        entry = (facts or {}).get(racer.teiban)
        out.append(
            f"| {racer.teiban} | {racer.name} | {racer.kyubetsu} | "
            f"{racer.zenkoku_shoritsu:.2f} | {_touchi_cell(racer)} | "
            f"{_history_cell(entry)} | "
            f"{racer.motor_no} | {_motor_cell(racer, entry)} | {racer.konsetsu or '—'} |"
        )
    out.append("")
    out.append(
        "<sub>「住之江実績」と「実測」は蓄積した過去の競走成績から数えた値で、括弧内が母数です。"
        "番組表の当地勝率とM2率は走数が公開されていないため、母数のわかる実測を並べています。"
        "判定は番組表の値で行い、実測は判断材料として添えています。</sub>"
    )
    out.append("")

    for note in _motor_gap_notes(race, facts):
        out.append(f"※ {note}")
    if _motor_gap_notes(race, facts):
        out.append("")

    if analysis.motor_picks:
        picks = ", ".join(f"{t}号艇 {r:.1f}%" for t, r in analysis.motor_picks)
        out.append(f"**モーター注目**: {picks}")
    else:
        out.append("**モーター注目**: 該当なし")
    out.append("")

    out.append(f"**買い目の型**：{analysis.bet_shape}")
    out.append("")

    for note in analysis.notes:
        out.append(f"※ {note}")
    if analysis.notes:
        out.append("")

    out.append(f"<sub>{FOOTNOTE}</sub>")
    out.append("")
    return out


CSV_HEADER = (
    "date",
    "race_no",
    "race_name",
    "distance_m",
    "deadline",
    "teiban",
    "toban",
    "name",
    "age",
    "branch",
    "weight",
    "kyubetsu",
    "zenkoku_shoritsu",
    "zenkoku_2ritsu",
    "touchi_shoritsu",
    "touchi_2ritsu",
    "no_touchi_data",
    "motor_no",
    "motor_2ritsu",
    "boat_no",
    "boat_2ritsu",
    "konsetsu",
    "in_confidence",
    "upset_risk",
    "verdict",
    "bet_shape",
)


def render_csv(program: Program, analyses: tuple[RaceAnalysis, ...]) -> str:
    """1行1艇のCSV。Excel で開くため呼び出し側で UTF-8 BOM を付ける。"""
    by_no = {a.race_no: a for a in analyses}
    buffer = io.StringIO(newline="")
    writer = csv.writer(buffer, lineterminator="\r\n")
    writer.writerow(CSV_HEADER)
    for race in program.races:
        analysis = by_no.get(race.race_no)
        for racer in race.racers:
            writer.writerow(
                [
                    program.date,
                    race.race_no,
                    race.name,
                    race.distance_m,
                    race.deadline,
                    racer.teiban,
                    racer.toban,
                    racer.name,
                    racer.age,
                    racer.branch,
                    racer.weight,
                    racer.kyubetsu,
                    f"{racer.zenkoku_shoritsu:.2f}",
                    f"{racer.zenkoku_2ritsu:.2f}",
                    f"{racer.touchi_shoritsu:.2f}",
                    f"{racer.touchi_2ritsu:.2f}",
                    "1" if racer.no_touchi_data else "0",
                    racer.motor_no,
                    f"{racer.motor_2ritsu:.2f}",
                    racer.boat_no,
                    f"{racer.boat_2ritsu:.2f}",
                    racer.konsetsu,
                    analysis.in_confidence if analysis else "",
                    analysis.upset_risk if analysis else "",
                    analysis.verdict if analysis else "",
                    analysis.bet_shape if analysis else "",
                ]
            )
    return buffer.getvalue()


#: スミノエ・ログ側のバリデーションと合わせるためのスキーマ版
JSON_SCHEMA_VERSION = 1


def render_json(
    program: Program, analyses: tuple[RaceAnalysis, ...], motor_line: float | None
) -> str:
    """スミノエ・ログ（観戦記録アプリ）へ貼り付けて取り込むための JSON。

    買い目そのものはアプリ側で組み立てる（当日の実測傾向で補正するため）。
    ここでは判断の材料になる評価値と、このツール側の判定を渡す。
    """
    by_no = {a.race_no: a for a in analyses}
    races: list[dict[str, object]] = []

    for race in program.races:
        analysis = by_no.get(race.race_no)
        races.append(
            {
                "raceNo": race.race_no,
                "name": race.name,
                "distanceM": race.distance_m,
                "deadline": race.deadline,
                "ok": race.ok,
                "parseError": race.parse_error,
                "inConfidence": analysis.in_confidence if analysis else None,
                "inReason": analysis.in_reason if analysis else None,
                "upsetRisk": analysis.upset_risk if analysis else None,
                "upsetReason": analysis.upset_reason if analysis else None,
                "verdict": analysis.verdict if analysis else None,
                "verdictReason": analysis.verdict_reason if analysis else None,
                "betShape": analysis.bet_shape if analysis else None,
                "motorPicks": [
                    {"teiban": teiban, "motorNiritsu": round(rate, 2)}
                    for teiban, rate in (analysis.motor_picks if analysis else ())
                ],
                "notes": list(analysis.notes) if analysis else [],
                "boats": [
                    {
                        "teiban": racer.teiban,
                        "name": racer.name,
                        "kyubetsu": racer.kyubetsu,
                        "age": racer.age,
                        "branch": racer.branch,
                        "zenkokuShoritsu": round(racer.zenkoku_shoritsu, 2),
                        "zenkokuNiritsu": round(racer.zenkoku_2ritsu, 2),
                        "touchiShoritsu": round(racer.touchi_shoritsu, 2),
                        "touchiNiritsu": round(racer.touchi_2ritsu, 2),
                        "noTouchiData": racer.no_touchi_data,
                        "evalShoritsu": round(racer.eval_shoritsu, 2),
                        "motorNo": racer.motor_no,
                        "motorNiritsu": round(racer.motor_2ritsu, 2),
                        "boatNo": racer.boat_no,
                        "boatNiritsu": round(racer.boat_2ritsu, 2),
                        "konsetsu": racer.konsetsu.strip(),
                    }
                    for racer in race.racers
                ],
            }
        )

    payload = {
        "schemaVersion": JSON_SCHEMA_VERSION,
        "date": program.date,
        "place": program.place,
        "title": program.title,
        "dayLabel": program.day_label,
        "motorLine": round(motor_line, 2) if motor_line is not None else None,
        "warnings": list(program.warnings),
        "races": races,
    }
    return json.dumps(payload, ensure_ascii=False, separators=(",", ":"))


def render_chat(
    program: Program, analyses: tuple[RaceAnalysis, ...], motor_line: float | None
) -> str:
    """Claude に貼って相談するための圧縮テキスト。1レース2〜3行・全体100行以内。"""
    by_no = {a.race_no: a for a in analyses}
    out: list[str] = []
    out.append(f"住之江 {_date_label(program.date)} {program.title} {program.day_label}".strip())
    if motor_line is not None:
        out.append(f"モーター注目ライン: 当日中央値+{MOTOR_PICK_MARGIN:.0f}pt = {motor_line:.1f}%以上")
    out.append("")

    for race in program.races:
        analysis = by_no.get(race.race_no)
        if analysis is None:
            continue
        if not race.ok:
            out.append(f"{race.race_no}R {race.name} 締{race.deadline} / 取得失敗")
            continue
        members = " ".join(
            f"{r.teiban}:{r.name}({r.kyubetsu},"
            f"{'当地なし' if r.no_touchi_data else f'当{r.touchi_shoritsu:.2f}'},"
            f"M{r.motor_2ritsu:.0f}%)"
            for r in race.racers
        )
        out.append(f"{race.race_no}R {race.name} 締{race.deadline} [{analysis.verdict}] "
                   f"イン{analysis.in_confidence}/波乱{analysis.upset_risk}")
        out.append(f"  {members}")
        out.append(f"  型: {analysis.bet_shape}")
    out.append("")
    out.append("※ 母数の小さい数値を断定的に扱わないこと。控除率25%を覆す前提の分析ではない。")
    return "\n".join(out)
