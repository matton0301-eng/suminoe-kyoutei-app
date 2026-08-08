"""Windows タスクスケジューラ用の XML を書き出す。

2種類のタスクを作れる。

  refresh  番組表を取得してアプリを更新（当日早朝5〜6時公開なので 05:10 開始）
  review   競走成績を取得して事前の読みと照合（全レース終了後なので 21:30 開始）

いずれも45分おきに繰り返し、取得できた回で終わる。
対応するシェルスクリプトは冪等なので、成功後の実行は何もせず即終了する。

重要な設定:
  StartWhenAvailable=true  予定時刻にPCが起動していなくても、起動後すぐに実行する
  WakeToRun=true           スリープからの復帰を試みる（休止/シャットダウンでは効かない）

    python make-task-xml.py                              # refresh / 2026-08-09 05:10
    python make-task-xml.py --action review --time 21:30
    python make-task-xml.py --action review --date 2026-08-07 --time 21:30
"""

from __future__ import annotations

import argparse
from pathlib import Path

HERE = Path(__file__).resolve().parent

ACTIONS = {
    "refresh": {
        "cmd": "refresh-and-deploy.cmd",
        "task": "Suminoe-RaceCard-Refresh",
        "xml": "task-refresh.xml",
        "time": "05:10",
        "what": "番組表を取得してスミノエ・ログを更新し、Vercel にデプロイする",
    },
    "review": {
        "cmd": "review-and-deploy.cmd",
        "task": "Suminoe-Result-Review",
        "xml": "task-review.xml",
        "time": "21:30",
        "what": "競走成績を取得して事前の読みと照合し、Vercel にデプロイする",
    },
}

TEMPLATE = """<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>{description}</Description>
  </RegistrationInfo>
  <Triggers>
    <TimeTrigger>
      <StartBoundary>{date}T{time}:00</StartBoundary>
      <Repetition>
        <Interval>PT45M</Interval>
        <Duration>PT8H</Duration>
        <StopAtDurationEnd>true</StopAtDurationEnd>
      </Repetition>
      <Enabled>true</Enabled>
    </TimeTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>true</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <IdleSettings>
      <StopOnIdleEnd>false</StopOnIdleEnd>
      <RestartOnIdle>false</RestartOnIdle>
    </IdleSettings>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>false</Hidden>
    <RunOnlyIfIdle>false</RunOnlyIfIdle>
    <WakeToRun>true</WakeToRun>
    <ExecutionTimeLimit>PT30M</ExecutionTimeLimit>
    <Priority>7</Priority>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>{command}</Command>
      <Arguments>{date}</Arguments>
      <WorkingDirectory>{workdir}</WorkingDirectory>
    </Exec>
  </Actions>
</Task>
"""


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--action", choices=sorted(ACTIONS), default="refresh")
    parser.add_argument("--date", default="2026-08-09", help="対象日 (YYYY-MM-DD)")
    parser.add_argument("--time", help="開始時刻 (HH:MM)。省略時は action の既定値")
    args = parser.parse_args()

    spec = ACTIONS[args.action]
    time = args.time or spec["time"]
    cmd_path = HERE / spec["cmd"]
    out_path = HERE / spec["xml"]

    xml = TEMPLATE.format(
        description=f"ボートレース住之江（{args.date}）: {spec['what']}。冪等なので何度実行しても安全。",
        date=args.date,
        time=time,
        command=str(cmd_path),
        workdir=str(HERE),
    )

    # schtasks は UTF-16 LE + BOM を要求する
    out_path.write_text(xml, encoding="utf-16")
    print(f"書き出し: {out_path} ({out_path.stat().st_size} バイト)")
    print(f"  内容: {spec['what']}")
    print(f"  開始: {args.date} {time} から45分おきに8時間")
    print(f"  実行: {cmd_path} {args.date}")
    print()
    print("登録するには（管理者権限は不要）:")
    print(f'  schtasks /create /xml "{out_path}" /tn "{spec["task"]}" /f')
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
