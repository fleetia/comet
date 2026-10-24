---
"comet": patch
"@comet/ui": minor
---

할 일 목록에서 계획 날짜와 마감을 따로 보여 줍니다. 날짜 칸은 계획 날짜만, 따로 정한 마감은 깃발이 붙은 테두리 칩으로 표시하고 기한이 지나면 칩만 빨갛게 바뀝니다. 날짜를 누르면 편집 시트의 **언제**에서 계획 날짜를, 마감 칩을 누르면 **마감**을 바로 바꿀 수 있습니다. `TaskRow`에 `deadline`·`plannedTime`·`onDueClick`·`onDeadlineClick`을 추가했고 `DeadlineChip`을 새로 제공합니다.
