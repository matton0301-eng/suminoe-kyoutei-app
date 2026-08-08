"""直前情報をアプリが読む JSON（tenji.json）に変換する。

**キー名はアプリの `lib/beforeInfo.ts` との契約**。Python 側は snake_case、
アプリ側は camelCase なので、ここでだけ名前を変える。片方を変えるときは必ず両方直す。

風向について: 公式ページには方位名の文字列が無く、アイコンの通し番号
（`is-wind1`〜`is-wind17`）でしか公開されていない。対応表を推測で作らず、
`windDirNo` として番号のまま渡す（計画書の草案は `windDir: "北"` だったが、
実データに無いものを作れないため番号に変更した）。
"""

from __future__ import annotations

from .beforeinfo_models import BeforeInfoDay, RaceBeforeInfo, TenjiEntry, WeatherInfo

#: tenji.json のスキーマ版。アプリ側は一致しないデータを読み捨てる
SCHEMA_VERSION = 1


def entry_payload(entry: TenjiEntry) -> dict:
    return {
        "teiban": entry.teiban,
        "name": entry.name,
        "weight": entry.weight,
        "tenjiTime": entry.tenji_time,
        "tilt": entry.tilt,
        "propeller": entry.propeller,
        "partsChanged": list(entry.parts_changed),
        "stCourse": entry.st_course,
        "stTime": entry.st_time,
    }


def weather_payload(weather: WeatherInfo | None) -> dict | None:
    if weather is None:
        return None
    return {
        "observedAt": weather.observed_at,
        "tempC": weather.temp_c,
        "weather": weather.weather,
        "windM": weather.wind_m,
        "windDirNo": weather.wind_dir_no,
        "waterTempC": weather.water_temp_c,
        "waveCm": weather.wave_cm,
    }


def race_payload(race: RaceBeforeInfo) -> dict:
    return {
        "raceNo": race.race_no,
        "available": race.available,
        "entries": [entry_payload(entry) for entry in race.entries],
        "weather": weather_payload(race.weather),
    }


def day_payload(day: BeforeInfoDay) -> dict:
    """アプリ用の1日ぶんのデータ。

    tuple は list に均している（json.dumps は通るが、辞書同士の比較で
    tuple != list になり、冪等判定が毎回 False になる）。
    """
    return {
        "schemaVersion": SCHEMA_VERSION,
        "date": day.date,
        "updatedAt": day.updated_at,
        "races": [race_payload(race) for race in day.races],
    }


def merge_with_previous(previous: dict | None, current: dict) -> dict:
    """取り損ねたレースは前回の内容を残す。

    直前情報は一度公開されたら消えない。取得に失敗したレースや、
    公式ページが一時的に空を返したレースをそのまま書き出すと、
    アプリの表示から展示タイムが消えてしまう（30分おきに走るので実害が出る）。

    判定は「前回 available=True・今回 available=False なら前回を使う」の一本。
    通信失敗のレースは呼び出し側が available=False として渡すので、
    失敗と未公開を区別せず同じ規則で扱える。日付が違う前回は使わない。
    """
    if not previous or previous.get("date") != current.get("date"):
        return current

    published = {
        race["raceNo"]: race for race in previous.get("races", ()) if race.get("available")
    }
    races = [
        race if race.get("available") else published.get(race["raceNo"], race)
        for race in current.get("races", ())
    ]
    return {**current, "races": races}


def is_same_content(previous: dict | None, current: dict) -> bool:
    """取得時刻を除いて中身が同じか。

    タスクスケジューラが30分おきに回すため、同じ内容で毎回ビルドとデプロイを
    走らせないための判定。`updatedAt` は毎回変わるので比較から外す。
    """
    if not previous:
        return False
    return (
        previous.get("schemaVersion") == current.get("schemaVersion")
        and previous.get("date") == current.get("date")
        and previous.get("races") == current.get("races")
    )
