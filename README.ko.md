# Claude Code 모드

[English](README.md) · [Русский](README.ru.md) · [简体中文](README.zh-CN.md) · [日本語](README.ja.md) · **한국어** · [Español](README.es.md) · [Português](README.pt-BR.md) · [Deutsch](README.de.md) · [Français](README.fr.md)

## plan-progress

Claude Code 입력창 위에 실시간 진행 막대를 표시합니다. Claude가 작업을 단계와 스텝으로 나누고, 작업이 진행될수록 막대가 채워집니다. 각 작업의 서브에이전트는 막대 아래에 표시됩니다.

![plan-progress: 에이전트가 있는 두 작업, 질문, 오류, 도중에 바뀐 계획, 두 작업 완료](media/plan-progress.gif)

[소리 포함 영상 (MP4, 14초)](media/plan-progress.mp4)

- 작업마다 한 줄: 상태, 제목, 막대, 퍼센트, 닫기 버튼
- 막대 위 라벨에 현재 단계와 스텝 표시, 마우스를 올리면 경과 시간 표시
- 단계는 캡슐, 스텝은 점으로 표시, 지난 점에 마우스를 올리면 걸린 시간, 앞의 점에서는 그곳에서 시작할 내용을 표시
- 완료된 막대는 초록색이 되고 총 소요 시간을 표시하며 닫을 때까지 남음. `/plan-progress-autoclose`를 켜면 `doneBarSeconds`(기본 30초, `/config`) 후에 저절로 사라짐
- 채우기와 서브에이전트 행의 점이 반짝임. `/config`에서 `twinkle`을 끄면 멈춘 채로 그려짐
- 네 가지 상태: 진행 중, 입력 필요, 오류, 완료
- 서브에이전트마다 작업 아래에 한 줄: 이름, 모델과 effort, 사용 중인 도구, 시간
- 계획은 도중에 바꿀 수 있으며, 완료된 스텝은 제목 기준으로 유지됩니다
- 막대는 세션별로 저장되어 세션을 다시 열면 복원됩니다
- 질문, 오류, 완료 시 짧은 알림음
- 하단에 메인 대화의 출력 속도 `⚡ N tok/s`를 표시 (서브에이전트는 제외)
- 옆의 ⚙ 버튼(데스크톱 앱과 전체 화면 터미널)으로 설정 창 열기: 효과, 자동 닫기와 그 시간(초), 소리, 이 속도 표시, 모드 버전과 업데이트 확인. `/plan-progress-settings`로 어디서나 열 수 있음. 창은 `/config`의 언어로 표시되며, 없으면 앱, 그다음 시스템 언어를 따름
- 업데이트: 설정 창의 버전을 누르면 새 릴리스를 찾고, '업데이트'를 누르면 설치한 뒤 그 자리에서 모드를 다시 불러옴(다시 불러오기가 안 되면 재시작을 요청). 6시간마다 모드가 직접 확인하고, 새 버전이 나오면 ⚙에 🔹(터미널에서는 ●)를 표시함. 확인은 GitHub API(`api.github.com/repos/zycck/claude-mods/releases`)에 보내는 요청 한 번이며 계정이나 세션 데이터는 담기지 않음. 창의 '업데이트 확인' 또는 `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`로 끌 수 있음. 폴더에서 설치한 사본은 확인하지 않음
- 데스크톱 앱과 터미널 모두 지원
- 터미널에서는 `auto` 테마일 때 GNOME 데스크톱의 라이트/다크를 따르고, 현재 Omarchy 테마의 색을 사용

### 설치

Claude Code 2.1.295 이상이 필요합니다(`claude --version`으로 확인, `claude update`로 업데이트). 이전 버전에서는 모드의 일부가 동작하지 않습니다. 설정 창이 비어 있으며, 2.1.286 미만에서는 훅 모듈이 아예 로드되지 않아 바가 표시되지 않고 시작 시 `plan-progress: hooks module did not load`가 표시됩니다.

```
/plugin marketplace add zycck/claude-mods
/plugin install plan-progress@zycck-mods
```

업데이트:

```
claude plugin marketplace update zycck-mods
claude plugin update plan-progress@zycck-mods
```

### 명령어

- `/progress` 막대 표시/숨기기
- `/progress-clear` 모든 막대 삭제
- `/progress-agents` 막대 아래의 에이전트 줄을 접거나 다시 표시 (막대의 ✕ 옆 화살표 버튼은 그 막대만)
- `/plan-progress-autoclose` 완료된 막대의 자동 닫기를 켜거나(기본값은 꺼짐) 다시 끔 (선택은 세션 간에 유지)
- `/plan-progress-settings` 하단의 ⚙처럼 설정 창 열기 (터미널에서는 전체 화면일 때만 ⚙ 표시)

### 동작 방식

모드는 `plan_progress` 도구를 등록합니다. Claude는 계획을 한 번 보낸 뒤 `{id, next: true}`, `{id, done: ["Routes"]}` 같은 짧은 업데이트를 보냅니다. 없는 스텝 이름은 해당 막대의 스텝 목록과 함께 거부됩니다. plan mode에서 승인한 계획은 막대 `plan`이 됩니다. 에이전트 줄은 엔진 이벤트에서 만들어지며 토큰을 쓰지 않습니다.

데스크톱에서 막대는 SVG 이미지이고 그 위에 호버 레이어가 있습니다. 터미널에서는 문자 그리드이며 Claude가 작업하는 동안에만 애니메이션됩니다.

### 테스트

`plugins/plan-progress/tests`는 실제 모듈을 스텁 엔진에서 실행합니다: `node compile.cjs ../hooks/register.tsx register.mjs` 후 `node regress.mjs`와 `node scenarios.mjs`.

## 라이선스

MIT
