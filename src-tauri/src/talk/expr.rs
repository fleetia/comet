use super::{Diagnostic, Registry, Span, ValueType};
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};

#[derive(Clone, Debug)]
pub enum Expr {
    Literal(Value),
    Variable(String),
    Not(Box<Expr>),
    Binary(Box<Expr>, Operator, Box<Expr>),
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Operator {
    And,
    Or,
    Eq,
    Ne,
    Lt,
    Le,
    Gt,
    Ge,
}
#[derive(Clone, Debug, PartialEq)]
enum Token {
    Value(Value),
    Name(String),
    Not,
    Op(Operator),
    Open,
    Close,
}

fn tokens(source: &str) -> Result<Vec<(Token, usize)>, String> {
    let mut result = Vec::new();
    let mut offset = 0;
    while offset < source.len() {
        let remaining = &source[offset..];
        let first = remaining.chars().next().ok_or("조건식이 비어 있어요.")?;
        if first.is_whitespace() {
            offset += first.len_utf8();
            continue;
        }
        let (token, length) = if first == '"' {
            let mut stream = serde_json::Deserializer::from_str(remaining).into_iter::<String>();
            let value = stream
                .next()
                .ok_or("문자열이 끝나지 않았어요.")?
                .map_err(|_| "문자열 escape 또는 닫는 따옴표가 잘못됐어요.")?;
            (Token::Value(Value::String(value)), stream.byte_offset())
        } else if first.is_ascii_digit() || first == '-' {
            let length = remaining
                .bytes()
                .take_while(|c| c.is_ascii_digit() || matches!(c, b'-' | b'+' | b'.' | b'e' | b'E'))
                .count();
            let value = serde_json::from_str::<Value>(&remaining[..length])
                .map_err(|_| "숫자 형식이 잘못됐어요.")?;
            if !value.is_number() {
                return Err("숫자가 필요해요.".into());
            }
            (Token::Value(value), length)
        } else if first.is_ascii_alphabetic() || first == '_' {
            let length = remaining
                .bytes()
                .take_while(|c| c.is_ascii_alphanumeric() || matches!(c, b'_' | b'.' | b'-'))
                .count();
            let name = &remaining[..length];
            let token = match name {
                "and" => Token::Op(Operator::And),
                "or" => Token::Op(Operator::Or),
                "not" => Token::Not,
                "true" => Token::Value(Value::Bool(true)),
                "false" => Token::Value(Value::Bool(false)),
                "null" => Token::Value(Value::Null),
                _ => Token::Name(name.into()),
            };
            (token, length)
        } else {
            let (token, length) = match remaining {
                s if s.starts_with("==") => (Token::Op(Operator::Eq), 2),
                s if s.starts_with("!=") => (Token::Op(Operator::Ne), 2),
                s if s.starts_with("<=") => (Token::Op(Operator::Le), 2),
                s if s.starts_with(">=") => (Token::Op(Operator::Ge), 2),
                s if s.starts_with('<') => (Token::Op(Operator::Lt), 1),
                s if s.starts_with('>') => (Token::Op(Operator::Gt), 1),
                s if s.starts_with('(') => (Token::Open, 1),
                s if s.starts_with(')') => (Token::Close, 1),
                _ => return Err(format!("조건식에 허용되지 않는 문자: {first}")),
            };
            (token, length)
        };
        result.push((token, source[..offset].chars().count()));
        if result.len() > 256 {
            return Err("조건식은 256개 token 이하여야 해요.".into());
        }
        offset += length;
    }
    Ok(result)
}
struct Reader {
    tokens: Vec<(Token, usize)>,
    at: usize,
}
impl Reader {
    fn parse(&mut self, minimum: u8, depth: usize) -> Result<Expr, String> {
        if depth > 32 {
            return Err("조건식 중첩은 32단계 이하여야 해요.".into());
        }
        let token = self
            .tokens
            .get(self.at)
            .map(|entry| entry.0.clone())
            .ok_or("조건식이 끝나기 전에 값이 필요해요.")?;
        self.at += 1;
        let mut left = match token {
            Token::Value(value) => Expr::Literal(value),
            Token::Name(name) => Expr::Variable(name),
            Token::Not => Expr::Not(Box::new(self.parse(3, depth + 1)?)),
            Token::Open => {
                let value = self.parse(0, depth + 1)?;
                if self.tokens.get(self.at).map(|entry| &entry.0) != Some(&Token::Close) {
                    return Err("닫는 괄호가 필요해요.".into());
                }
                self.at += 1;
                value
            }
            _ => return Err("조건식의 값이나 변수가 필요해요.".into()),
        };
        while let Some((Token::Op(operator), _)) = self.tokens.get(self.at) {
            let operator = *operator;
            let precedence = match operator {
                Operator::Or => 1,
                Operator::And => 2,
                _ => 3,
            };
            if precedence < minimum {
                break;
            }
            self.at += 1;
            let right = self.parse(precedence + 1, depth + 1)?;
            left = Expr::Binary(Box::new(left), operator, Box::new(right));
        }
        Ok(left)
    }
}
pub(crate) fn parse(source: &str, registry: &Registry, span: &Span) -> Result<Expr, Diagnostic> {
    let tokens = tokens(source).map_err(|message| span.error("EXPRESSION_SYNTAX", message))?;
    let mut reader = Reader { tokens, at: 0 };
    let expression = reader.parse(0, 0).map_err(|message| {
        let mut location = span.clone();
        location.column += reader
            .tokens
            .get(reader.at)
            .map(|entry| entry.1)
            .unwrap_or(source.chars().count());
        location.error("EXPRESSION_SYNTAX", message)
    })?;
    if reader.at != reader.tokens.len() {
        return Err(span.error("EXPRESSION_SYNTAX", "조건식 끝에 불필요한 문자가 있어요."));
    }
    if infer(&expression, registry).map_err(|message| span.error("EXPRESSION_TYPE", message))?
        != Some(ValueType::Boolean)
    {
        return Err(span.error("EXPRESSION_TYPE", "조건식은 boolean이어야 해요."));
    }
    Ok(expression)
}
fn infer(expression: &Expr, registry: &Registry) -> Result<Option<ValueType>, String> {
    match expression {
        Expr::Literal(value) => Ok(if value.is_boolean() {
            Some(ValueType::Boolean)
        } else if value.is_number() {
            Some(ValueType::Number)
        } else if value.is_string() {
            Some(ValueType::String)
        } else {
            None
        }),
        Expr::Variable(name) => registry
            .variables
            .get(name)
            .map(|variable| Some(variable.kind))
            .ok_or_else(|| format!("등록되지 않은 변수: {name}")),
        Expr::Not(value) => {
            if infer(value, registry)? != Some(ValueType::Boolean) {
                return Err("not에는 boolean이 필요해요.".into());
            }
            Ok(Some(ValueType::Boolean))
        }
        Expr::Binary(left, operator, right) => {
            let left = infer(left, registry)?;
            let right = infer(right, registry)?;
            let valid = match operator {
                Operator::And | Operator::Or => {
                    left == Some(ValueType::Boolean) && right == Some(ValueType::Boolean)
                }
                Operator::Eq | Operator::Ne => left.is_none() || right.is_none() || left == right,
                _ => left == Some(ValueType::Number) && right == Some(ValueType::Number),
            };
            if !valid {
                return Err("연산자와 변수의 타입이 맞지 않아요.".into());
            }
            Ok(Some(ValueType::Boolean))
        }
    }
}
pub(crate) fn references(expression: &Expr, target: &mut BTreeSet<String>) {
    match expression {
        Expr::Variable(name) => {
            target.insert(name.clone());
        }
        Expr::Not(value) => references(value, target),
        Expr::Binary(left, _, right) => {
            references(left, target);
            references(right, target);
        }
        Expr::Literal(_) => {}
    }
}
pub(crate) fn evaluate(
    expression: &Expr,
    values: &BTreeMap<String, Value>,
) -> Result<Value, String> {
    match expression {
        Expr::Literal(value) => Ok(value.clone()),
        Expr::Variable(name) => values
            .get(name)
            .cloned()
            .ok_or_else(|| format!("변수 값이 없어요: {name}")),
        Expr::Not(value) => Ok(Value::Bool(!boolean(evaluate(value, values)?)?)),
        Expr::Binary(left, operator, right) => {
            let left = evaluate(left, values)?;
            if *operator == Operator::And && !boolean(left.clone())? {
                return Ok(Value::Bool(false));
            }
            if *operator == Operator::Or && boolean(left.clone())? {
                return Ok(Value::Bool(true));
            }
            let right = evaluate(right, values)?;
            let result = match operator {
                Operator::And | Operator::Or => boolean(right)?,
                Operator::Eq => equal(&left, &right),
                Operator::Ne => !equal(&left, &right),
                operator => {
                    let order = compare_numbers(&left, &right)
                        .ok_or("숫자 비교에 null 또는 숫자가 아닌 값이 있어요.")?;
                    match operator {
                        Operator::Lt => order.is_lt(),
                        Operator::Le => !order.is_gt(),
                        Operator::Gt => order.is_gt(),
                        Operator::Ge => !order.is_lt(),
                        _ => false,
                    }
                }
            };
            Ok(Value::Bool(result))
        }
    }
}
fn equal(left: &Value, right: &Value) -> bool {
    if left.is_number() && right.is_number() {
        compare_numbers(left, right).is_some_and(|order| order.is_eq())
    } else {
        left == right
    }
}
fn compare_numbers(left: &Value, right: &Value) -> Option<std::cmp::Ordering> {
    if let (Some(left), Some(right)) = (left.as_i64(), right.as_i64()) {
        return Some(left.cmp(&right));
    }
    if let (Some(left), Some(right)) = (left.as_u64(), right.as_u64()) {
        return Some(left.cmp(&right));
    }
    if left.as_i64().is_some_and(|value| value < 0) && right.as_u64().is_some() {
        return Some(std::cmp::Ordering::Less);
    }
    if right.as_i64().is_some_and(|value| value < 0) && left.as_u64().is_some() {
        return Some(std::cmp::Ordering::Greater);
    }
    left.as_f64()?.partial_cmp(&right.as_f64()?)
}
pub(crate) fn boolean(value: Value) -> Result<bool, String> {
    value
        .as_bool()
        .ok_or_else(|| "조건 결과가 boolean이 아니에요.".into())
}
