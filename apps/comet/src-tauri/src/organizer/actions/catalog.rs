use super::{err, Result};
use rusqlite::Connection;
use serde_json::{json, Value};

#[derive(Clone, Copy)]
pub(super) struct Definition {
    pub id: &'static str,
    pub owner: &'static str,
    pub action: &'static str,
    pub collection: &'static str,
    pub effect: &'static str,
    pub automatic: bool,
    pub undo: bool,
    pub target: bool,
    pub fields: &'static str,
    pub required: &'static str,
    pub description: &'static str,
}

macro_rules! definition {
    ($id:literal,$owner:literal,$action:literal,$collection:literal,$effect:literal,$automatic:literal,$undo:literal,$target:literal,$fields:literal,$required:literal,$description:literal) => {
        Definition {
            id: $id,
            owner: $owner,
            action: $action,
            collection: $collection,
            effect: $effect,
            automatic: $automatic,
            undo: $undo,
            target: $target,
            fields: $fields,
            required: $required,
            description: $description,
        }
    };
}

pub(super) const DEFINITIONS: &[Definition] = &[
    definition!("ledger_query","diary","","ledgerEntries","read",false,false,false,"query,from,through,kind,category","","가계부 수입·지출 조회. 금액은 원 단위 정수. 날짜 범위는 양 끝 포함."),
    definition!("ledger_create","diary","ledger-entry-create","ledgerEntries","write",true,true,false,"date,kind,amount,category,title,memo","date,kind,amount,category,title","실제로 발생한 본인의 수입·지출 기록. 예정·가정·인용·타인의 지출은 자동 기록하지 않는다. category는 현재 categories의 ID."),
    definition!("ledger_update","diary","ledger-entry-update","ledgerEntries","write",false,true,true,"date,kind,amount,category,title,memo","","선택한 가계부 항목의 명시한 필드만 수정."),
    definition!("ledger_delete","diary","ledger-entry-delete","ledgerEntries","write",false,true,true,"","","선택한 가계부 항목 삭제."),
    definition!("habit_query","diary","","habits","read",false,false,false,"query,from,through","","습관 정의와 날짜별 체크·횟수 조회."),
    definition!("habit_create","diary","habit-create","habits","write",false,true,false,"title,description,color,weekdays,weeklyGoal,mode,target,startDate,reminderTime","title,weekdays,weeklyGoal,mode,target,startDate","반복 습관 생성. weekdays는 일요일 0부터 토요일 6, mode는 check 또는 count."),
    definition!("habit_record","diary","habit-check","habitChecks","write",true,true,true,"date,status,count","date,status","이미 등록한 습관의 해당 날짜 기록. targetId는 습관 ID. status done/missed/clear. count는 추가량이 아닌 그날의 최종 누적 횟수."),
    definition!("habit_update","diary","habit-update","habits","write",false,true,true,"title,description,color,weekdays,weeklyGoal,mode,target,startDate,reminderTime","","기존 습관의 명시한 필드만 수정."),
    definition!("habit_archive","diary","habit-archive","habits","write",false,true,true,"archived","archived","습관을 보관하거나 다시 꺼낸다. 기록은 보존."),
    definition!("time_query","diary","","timeRecords","read",false,false,false,"query,from,through","","날짜별 시간 기록과 시간 분류 조회."),
    definition!("time_record","diary","time-record-save","timeRecords","write",false,true,false,"date,startMinute,endMinute,categoryId,title","date,startMinute,endMinute,categoryId","시간 기록 추가. 10분 단위. 겹친 시간 기록은 덮어쓰므로 사용자에게 겹침을 설명하고 명시 요청 때만 실행. 자정은 날짜별 분리."),
    definition!("time_delete","diary","time-record-delete","timeRecords","write",false,true,true,"","","선택한 시간 기록 삭제."),
    definition!("note_query","diary","","notes","read",false,false,false,"query","","다이어리 안의 메모 조회. 바탕화면 메모는 memo_query."),
    definition!("note_create","diary","note-create","notes","write",false,true,false,"title,body","title,body","다이어리에 메모 저장. 사용자의 원문과 줄바꿈 보존."),
    definition!("note_update","diary","note-update","notes","write",false,true,true,"title,body","","다이어리 메모의 지정 필드 수정. 잘린 본문을 대체하지 않는다."),
    definition!("note_delete","diary","note-delete","notes","write",false,true,true,"","","다이어리 메모 삭제."),
    definition!("page_query","diary","","pages","read",false,false,false,"query,from,through","","다이어리 페이지와 기록 조회."),
    definition!("page_create","diary","page-create","pages","write",false,true,false,"title,date","title","다이어리 페이지 생성. 날짜 페이지는 date, 자유 페이지는 title 지정."),
    definition!("page_record","diary","entry-add","pages","write",false,true,true,"text,time,recordDate","text","선택한 다이어리 페이지에 원문 기록 추가. targetId는 페이지 ID."),
    definition!("task_query","todo","","items","read",false,false,false,"query,from,through","","할 일과 목록 조회."),
    definition!("task_add","todo","add","items","write",false,true,false,"title,memo,listId,dueDate,dueAt,plannedDate,planPeriod,planAnchor,repeat","title","할 일 생성. listId는 조회한 목록 ID, 미지정이면 기본 목록."),
    definition!("task_update","todo","update","items","write",false,true,true,"title,memo,listId,dueDate,dueAt,plannedDate,planPeriod,planAnchor,repeat","","기존 할 일의 명시한 필드만 수정."),
    definition!("task_complete","todo","complete","items","write",true,true,true,"","","명확하게 특정한 기존 할 일을 완료 처리. 반복 할 일은 다음 항목도 생성될 수 있음."),
    definition!("task_undo","todo","undo","items","write",false,true,true,"","","기존 할 일의 완료 취소."),
    definition!("task_delete","todo","delete","items","write",false,true,true,"","","선택한 할 일 삭제."),
    definition!("event_query","calendar","","events","read",false,false,false,"query,from,through","","연결된 캘린더와 Comet 일정 조회. 외부 캘린더는 읽기 전용."),
    definition!("event_add","calendar","create-event","events","write",false,true,false,"title,allDay,startAt,endAt,startDate,endDate,timeZone,location,description","title,allDay","Comet 로컬 일정 생성. 종일 endDate는 마지막 날 다음 날짜. 시간 일정에는 millisecond timestamp와 timeZone 사용."),
    definition!("event_update","calendar","update-event","events","write",false,true,true,"title,allDay,startAt,endAt,startDate,endDate,timeZone,location,description","","Comet 로컬 일정의 지정 필드만 수정. 외부 캘린더 수정 불가."),
    definition!("event_delete","calendar","delete-event","events","write",false,true,true,"","","Comet 로컬 일정 삭제. 외부 캘린더 삭제 불가."),
    definition!("memo_query","memo","","notes","read",false,false,false,"query","","바탕화면 메모 조회. 다이어리 메모는 note_query."),
    definition!("memo_create","memo","add","notes","write",false,true,false,"title,body","title,body","바탕화면 메모 생성. 원문·줄바꿈 보존. 접힌 메모로 생성."),
    definition!("memo_update","memo","update","notes","write",false,true,true,"title,body","","바탕화면 메모 수정. 잘린 원문을 대체하지 않는다."),
    definition!("memo_delete","memo","delete","notes","write",false,true,true,"","","선택한 바탕화면 메모 삭제."),
    definition!("preparation_query","preparation","","envelopes","read",false,false,false,"query,from,through","","준비 봉투와 체크 목록 조회."),
    definition!("preparation_create","preparation","create","envelopes","write",false,true,false,"title,date,checks","title","준비 봉투 생성. checks는 준비할 내용 문자열 배열."),
    definition!("preparation_update","preparation","update","envelopes","write",false,true,true,"title,date,archived","","준비 봉투 제목·날짜·보관 상태 수정."),
    definition!("preparation_check_add","preparation","check-add","envelopes","write",false,true,true,"text","text","선택한 준비 봉투에 체크 항목 추가."),
    definition!("preparation_check_toggle","preparation","check-toggle","envelopes","write",false,true,true,"checkId","checkId","선택한 준비 봉투의 기존 체크 항목 완료 상태 전환."),
    definition!("clock_query","clock","","anniversaries","read",false,false,false,"query,from,through","","기념일과 디데이 조회."),
    definition!("anniversary_add","clock","add","anniversaries","write",false,true,false,"title,date,countMode,repeat,celebrate","title,date","기념일 등록. countMode remaining/elapsed/anniversary, repeat none/yearly."),
    definition!("anniversary_update","clock","update","anniversaries","write",false,true,true,"title,date,countMode,repeat,celebrate","","기존 기념일 수정."),
    definition!("focus_query","focus-timer","","","read",false,false,false,"","","집중 타이머의 현재 상태와 최근 세션 조회."),
    definition!("focus_start","focus-timer","start","","control",false,false,false,"durationMs,title,todoId","","집중 타이머 시작. durationMs는 밀리초. todoId를 지정하면 해당 할 일로 새 맥락을 시작하며 이전 메모·일정·노트 연결을 비운다. title을 생략하면 할 일 제목을 쓴다."),
    definition!("focus_pause","focus-timer","pause","","control",false,false,false,"","","실행 중인 집중 타이머 일시정지."),
    definition!("focus_resume","focus-timer","resume","","control",false,false,false,"","","일시정지한 집중 타이머 재개."),
    definition!("focus_cancel","focus-timer","cancel","","control",false,false,false,"","","집중 타이머 종료. 진행 시간은 기존 규칙으로 기록."),
    definition!("focus_rest","focus-timer","rest","","control",false,false,false,"durationMs","","완료한 집중 타이머에서 휴식 시작."),
    definition!("weather_query","weather","","","read",false,false,false,"","","설정한 지역의 마지막 날씨 관측 조회. observedAt과 오류를 확인하고 현재 날씨로 단정하지 않는다."),
    definition!("music_query","music","","","read",false,false,false,"","","현재 연결에서 마지막으로 관측한 음악 정보 조회. 재생 제어·연결 설정은 제공하지 않음."),
    definition!("interaction_query","interaction","","","read",false,false,false,"","","캐릭터 교감 위젯 상태 조회."),
    definition!("interaction_open","interaction","desktop-open","","control",false,false,false,"","","캐릭터 교감 창을 연다. 교감 행동을 자동으로 실행하지 않는다."),
    definition!("ball_query","ball","","","read",false,false,false,"","","공 위젯 상태 조회."),
    definition!("ball_open","ball","desktop-open","","control",false,false,false,"","","바탕화면에 공을 꺼낸다."),
    definition!("paper_plane_query","paper-plane","","","read",false,false,false,"","","종이비행기 위젯 상태 조회."),
    definition!("paper_plane_open","paper-plane","desktop-open","","control",false,false,false,"","","바탕화면에 종이비행기를 꺼낸다."),
    definition!("bubbles_query","bubbles","","","read",false,false,false,"","","비눗방울 위젯 상태 조회."),
    definition!("bubbles_make","bubbles","make","","control",false,false,false,"","","비눗방울 만들기."),
    definition!("match_query","small-match","","","read",false,false,false,"","","작은 승부의 최근 결과 조회."),
    definition!("match_dice","small-match","dice","","control",false,false,false,"","","주사위를 굴린다."),
    definition!("match_coin","small-match","coin","","control",false,false,false,"choice","choice","동전을 던진다. choice는 heads 또는 tails."),
    definition!("fortune_query","fortune","","","read",false,false,false,"","","최근 장난 운세 조회. 실제 예측이 아닌 가상 놀이."),
    definition!("fortune_draw","fortune","draw","","control",false,false,false,"","","가상의 장난 운세 뽑기."),
    definition!("travel_query","diary","","travels","read",false,false,false,"query,travelId,from,through","","여행 목록과 단계(planning/before/traveling/wrapping/done) 조회. travelId를 주면 그 여행의 일정·예약·비용·사람·보낸 기록과 앱이 계산한 비용 요약(summary)·정산(settlement)을 돌려준다. 금액 합계·정산은 이 값만 쓴다."),
    definition!("travel_create","diary","travel-create","travels","write",false,true,false,"title,destination,startDate,endDate,timeZone,currency,budget","title,startDate,endDate,timeZone,currency","여행 만들기. timeZone은 현지 IANA 시간대, currency는 결제 통화(KRW 등), budget은 원화 예산 정수. 마지막 날은 첫날부터 1년 안."),
    definition!("travel_update","diary","travel-update","travels","write",false,true,true,"title,destination,startDate,endDate,timeZone,currency,budget","","기존 여행의 명시한 필드만 수정."),
    definition!("travel_delete","diary","travel-delete","travels","write",false,true,true,"","","여행과 그 일정·예약·비용·사람·보낸 기록·사진 기록 삭제. 가계부에 들어간 기록은 남는다. 앱이 먼저 확인 질문을 한다."),
    definition!("travel_finish","diary","travel-update","travels","write",false,true,true,"finished","finished","정리 마치기(finished=true) 또는 다시 정리하기(finished=false)."),
    definition!("travel_plan_add","diary","travel-plan-create","travelPlans","write",false,true,false,"travelId,kind,date,time,title,place,memo,arriveDate,arriveTime,departZone,arriveZone,bookingId","travelId,kind,date,title","여행 일정 추가. kind plan(일반)/move(이동). 날짜·시각은 여행 시간대 YYYY-MM-DD·HH:MM, N일째는 첫날이 1일째. move는 time(출발)·arriveDate·arriveTime이 모두 필요하고 시간대가 다르면 departZone/arriveZone. 모델이 추천한 일정은 사용자가 고른 것만 저장."),
    definition!("travel_plan_update","diary","travel-plan-update","travelPlans","write",false,true,true,"kind,date,time,title,place,memo,arriveDate,arriveTime,departZone,arriveZone,bookingId","","기존 여행 일정의 명시한 필드만 수정. 다른 여행으로 옮길 수 없다."),
    definition!("travel_plan_delete","diary","travel-plan-delete","travelPlans","write",false,true,true,"","","여행 일정 삭제."),
    definition!("travel_booking_add","diary","travel-booking-create","travelBookings","write",false,true,false,"travelId,kind,title,vendor,confirmation,status,amount,currency,rate,category,paidDate,startDate,startTime,startZone,endDate,endTime,endZone,place,destination,cancelDate,cancelTime,link,memo","travelId,kind,title,status,startDate","여행 예약 추가. kind flight/train/bus/stay/car/ticket/food/other, status paid/onsite/unpaid. amount·rate는 사용자가 적은 소수 문자열. currency 생략 시 여행 통화, rate 생략 시 context.lastRates, 둘 다 없으면 question으로 묻는다. 환율을 추정하지 않는다. confirmation·link는 request에 그대로 있는 값만. 바우처·위치는 여행 창에서."),
    definition!("travel_booking_update","diary","travel-booking-update","travelBookings","write",false,true,true,"kind,title,vendor,confirmation,status,amount,currency,rate,category,paidDate,startDate,startTime,startZone,endDate,endTime,endZone,place,destination,cancelDate,cancelTime,link,memo","","기존 예약의 명시한 필드만 수정. 가려진 예약번호(••••)를 다시 보내지 않는다."),
    definition!("travel_booking_delete","diary","travel-booking-delete","travelBookings","write",false,true,true,"","","예약과 그 예약에서 생긴 비용·가계부 기록 삭제."),
    definition!("travel_expense_add","diary","travel-expense-create","travelExpenses","write",false,true,false,"travelId,title,date,amount,currency,rate,category,paid,payer,shares,memo","travelId,title,date,amount,paid","여행 비용 추가. amount·rate는 사용자가 적은 소수 문자열. paid는 낸 비용 true, 예정 false. payer 생략 시 나(me), shares 생략 시 모두 똑같이. payer·shares.person은 context의 사람 ID 또는 me."),
    definition!("travel_expense_update","diary","travel-expense-update","travelExpenses","write",false,true,true,"title,date,amount,currency,rate,category,paid,payer,shares,memo","","기존 여행 비용의 명시한 필드만 수정. 예약에서 생긴 비용의 금액·날짜·결제는 예약 수정으로 바꾼다."),
    definition!("travel_expense_delete","diary","travel-expense-delete","travelExpenses","write",false,true,true,"","","여행 비용과 연결된 가계부 기록 삭제. 예약에서 생긴 비용은 예약에서 지운다."),
    definition!("travel_person_add","diary","travel-person-create","travelPeople","write",false,true,false,"travelId,name","travelId,name","함께 가는 사람 추가. 똑같이 나누던 비용에 함께 들어간다."),
    definition!("travel_person_update","diary","travel-person-update","travelPeople","write",false,true,true,"name","name","함께 가는 사람 이름 바꾸기."),
    definition!("travel_person_delete","diary","travel-person-delete","travelPeople","write",false,true,true,"","","함께 가는 사람 삭제. 낸 비용이나 보낸 기록이 있으면 지울 수 없다."),
    definition!("travel_transfer_add","diary","travel-transfer-create","travelTransfers","write",false,true,false,"travelId,from,to,amount,date","travelId,from,to,amount,date","정산 중 보낸 기록 추가. amount는 원 단위 정수, from·to는 사람 ID 또는 me."),
    definition!("travel_transfer_delete","diary","travel-transfer-delete","travelTransfers","write",false,true,true,"","","보낸 기록 삭제."),
];

pub(super) fn definition(id: &str) -> Result<&'static Definition> {
    DEFINITIONS
        .iter()
        .find(|item| item.id == id)
        .ok_or_else(|| "등록되지 않은 작업이에요.".into())
}

/// Travel fields share names with ledger and habit fields but not their meaning.
fn travel_property(kind: &str, field: &str) -> Option<Value> {
    Some(match field {
        "amount" if kind == "travel_transfer_add" => {
            json!({"type":"integer","minimum":1,"maximum":100_000_000_000_u64})
        }
        "budget" => json!({"type":"integer","minimum":0,"maximum":100_000_000_000_u64}),
        "amount" | "rate" => json!({
            "type":"string","maxLength":20,
            "description":"사용자가 적은 숫자 그대로의 소수 문자열. rate는 결제 통화 1단위가 몇 원인지.",
            "examples":["12.50","1200","9.12"]
        }),
        "kind" if kind.starts_with("travel_plan") => {
            json!({"type":"string","enum":["plan","move"]})
        }
        "kind" => {
            json!({"type":"string","enum":["flight","train","bus","stay","car","ticket","food","other"]})
        }
        "status" => json!({"type":"string","enum":["paid","onsite","unpaid"]}),
        "paid" | "finished" => json!({"type":"boolean"}),
        "shares" => json!({
            "type":"array","minItems":1,"maxItems":31,
            "items":{"type":"object","required":["person","weight"],"properties":{
                "person":{"type":"string","maxLength":200},
                "weight":{"type":"integer","minimum":1,"maximum":100}
            }}
        }),
        "date" | "startDate" | "endDate" | "arriveDate" | "paidDate" | "cancelDate" => {
            json!({"type":["string","null"],"maxLength":10,"description":"YYYY-MM-DD"})
        }
        "time" | "arriveTime" | "startTime" | "endTime" | "cancelTime" => {
            json!({"type":["string","null"],"maxLength":5,"description":"HH:MM"})
        }
        "departZone" | "arriveZone" | "startZone" | "endZone" | "timeZone" => {
            json!({"type":["string","null"],"maxLength":64,"description":"IANA 시간대"})
        }
        _ => return None,
    })
}

fn property(kind: &str, field: &str) -> Value {
    if let Some(value) = kind
        .starts_with("travel_")
        .then(|| travel_property(kind, field))
        .flatten()
    {
        return value;
    }
    match field {
        "amount" => json!({"type":"integer","minimum":1,"maximum":100_000_000_000_u64}),
        "count" | "weeklyGoal" | "target" => json!({"type":"integer","minimum":1,"maximum":10000}),
        "startMinute" | "endMinute" => {
            json!({"type":"integer","minimum":0,"maximum":1440,"multipleOf":10})
        }
        "durationMs" => json!({"type":"integer","minimum":1000,"maximum":86_400_000}),
        "dueAt" | "startAt" | "endAt" => json!({"type":["integer","null"]}),
        "allDay" | "archived" | "celebrate" => json!({"type":"boolean"}),
        "weekdays" => {
            json!({"type":"array","minItems":1,"maxItems":7,"items":{"type":"integer","minimum":0,"maximum":6}})
        }
        "checks" => {
            json!({"type":"array","maxItems":100,"items":{"type":"string","minLength":1,"maxLength":1000}})
        }
        "kind" => json!({"type":"string","enum":["income","expense"]}),
        "status" => json!({"type":"string","enum":["done","missed","clear"]}),
        "mode" => json!({"type":"string","enum":["check","count"]}),
        "body" | "memo" | "text" | "description" => json!({"type":"string","maxLength":20000}),
        "from" | "through" => json!({
            "type":"string","maxLength":1000,
            "description":"조회 시작일(from)과 마지막 날(through)은 양 끝을 포함한다. anchorTime 기준 YYYY-MM-DD로 보낸다. 하루 조회는 두 값에 같은 날짜를 쓴다. 경계가 없으면 해당 필드를 생략한다. 기존 요청의 시간대 포함 RFC3339 값도 허용하며 그 오프셋의 날짜로 해석하고 시각은 사용하지 않는다.",
            "examples":["2026-10-21"]
        }),
        "dueDate" | "plannedDate" | "planAnchor" | "reminderTime" | "date" => {
            json!({"type":["string","null"],"maxLength":20})
        }
        _ => json!({"type":"string","maxLength":1000}),
    }
}

pub(super) fn schema(definition: &Definition) -> Value {
    let properties: serde_json::Map<String, Value> = definition
        .fields
        .split(',')
        .filter(|key| !key.is_empty())
        .map(|key| (key.into(), property(definition.id, key)))
        .collect();
    let required: Vec<_> = definition
        .required
        .split(',')
        .filter(|key| !key.is_empty())
        .collect();
    json!({"type":"object","properties":properties,"required":required,"additionalProperties":false})
}

pub(crate) fn catalog(db: &Connection) -> Result<Vec<Value>> {
    let widgets = crate::widgets::storage::instances(db)?;
    Ok(DEFINITIONS.iter().filter(|definition| definition.owner == "diary" || widgets.iter().any(|widget| widget.kind == definition.owner)).map(|definition| json!({"id":definition.id,"effect":definition.effect,"automatic":definition.automatic,"receipt":definition.effect != "read" && definition.action != "desktop-open","undoSupported":definition.undo,"requiresTarget":definition.target,"owner":definition.owner,"description":definition.description,"inputSchema":schema(definition)})).collect())
}

pub(super) fn validate(definition: &Definition, input: &Value) -> Result<()> {
    let object = input.as_object().ok_or("작업 입력은 객체여야 해요.")?;
    if serde_json::to_vec(input).map_err(err)?.len() > 32_000 {
        return Err("작업 입력이 너무 길어요.".into());
    }
    let schema = schema(definition);
    for key in definition.required.split(',').filter(|key| !key.is_empty()) {
        if !object.contains_key(key) || object[key].is_null() {
            return Err(format!("{key} 값이 필요해요."));
        }
    }
    for (key, value) in object {
        let field = schema["properties"]
            .get(key)
            .ok_or_else(|| format!("{key} 필드는 이 작업에서 허용하지 않아요."))?;
        validate_value(value, field)?;
    }
    Ok(())
}

fn validate_value(value: &Value, schema: &Value) -> Result<()> {
    let type_matches = |kind: &str| match kind {
        "string" => value.is_string(),
        "integer" => value.as_i64().is_some() || value.as_u64().is_some(),
        "boolean" => value.is_boolean(),
        "array" => value.is_array(),
        "null" => value.is_null(),
        "object" => value.is_object(),
        _ => false,
    };
    let valid = schema["type"].as_str().is_some_and(type_matches)
        || schema["type"]
            .as_array()
            .is_some_and(|types| types.iter().filter_map(Value::as_str).any(type_matches));
    if !valid {
        return Err("작업 입력의 값 형식이 올바르지 않아요.".into());
    }
    if schema["enum"]
        .as_array()
        .is_some_and(|values| !values.contains(value))
    {
        return Err("지원하지 않는 선택 값이에요.".into());
    }
    if let Some(text) = value.as_str() {
        if schema["maxLength"]
            .as_u64()
            .is_some_and(|max| text.chars().count() > max as usize)
            || schema["minLength"]
                .as_u64()
                .is_some_and(|min| text.chars().count() < min as usize)
        {
            return Err("작업 입력의 글자 수를 확인해 주세요.".into());
        }
    }
    if let Some(number) = value.as_f64() {
        if schema["minimum"].as_f64().is_some_and(|min| number < min)
            || schema["maximum"].as_f64().is_some_and(|max| number > max)
            || schema["multipleOf"]
                .as_f64()
                .is_some_and(|step| number % step != 0.0)
        {
            return Err("작업 입력의 숫자 범위를 확인해 주세요.".into());
        }
    }
    if let Some(values) = value.as_array() {
        if schema["maxItems"]
            .as_u64()
            .is_some_and(|max| values.len() > max as usize)
            || schema["minItems"]
                .as_u64()
                .is_some_and(|min| values.len() < min as usize)
        {
            return Err("작업 입력의 항목 수를 확인해 주세요.".into());
        }
        for value in values {
            validate_value(value, &schema["items"])?;
        }
    }
    if let (Some(fields), Some(properties)) = (value.as_object(), schema["properties"].as_object())
    {
        for key in schema["required"].as_array().into_iter().flatten() {
            if !key.as_str().is_some_and(|key| fields.contains_key(key)) {
                return Err("작업 입력의 값 형식이 올바르지 않아요.".into());
            }
        }
        for (key, value) in fields {
            validate_value(
                value,
                properties
                    .get(key)
                    .ok_or("작업 입력의 값 형식이 올바르지 않아요.")?,
            )?;
        }
    }
    Ok(())
}
