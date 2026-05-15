# 메모리 관리 가이드: Java · JavaScript · Dart

> 같은 `Counter` 예제로 세 언어의 메모리 모델 차이를 비교한 정리 노트

---

## 목차

1. [메모리 3대 영역 기초](#1-메모리-3대-영역-기초)
2. [세 언어 한눈에 비교](#2-세-언어-한눈에-비교)
3. [Java 메모리 모델](#3-java-메모리-모델)
4. [JavaScript 메모리 모델](#4-javascript-메모리-모델)
5. [Dart 메모리 모델](#5-dart-메모리-모델)
6. [⚠️ 함정: static 키워드 ≠ static 메모리 영역](#6-️-함정-static-키워드--static-메모리-영역)
7. [1급객체 함수 비교](#7-1급객체-함수-비교)
8. [클래스 밖 변수/함수 비교](#8-클래스-밖-변수함수-비교)
9. [GC와 메모리 누수 공통 법칙](#9-gc와-메모리-누수-공통-법칙)
10. [최종 정리](#10-최종-정리)

---

## 1. 메모리 3대 영역 기초

프로그램이 실행될 때 메모리는 크게 세 영역으로 나뉩니다.

### 📚 Stack (스택)

- 함수 호출이 일어날 때마다 "스택 프레임"이 쌓임
- 지역 변수, 매개변수, 원시 타입 값, 객체 참조(주소)가 저장됨
- 함수가 끝나면 프레임이 자동으로 pop
- **빠르지만 작다** (보통 1MB 정도, StackOverflowError가 여기서 발생)
- LIFO(Last In First Out) 구조

### 🌳 Heap (힙)

- `new` 등으로 만든 모든 객체가 저장됨
- 모든 스레드/실행 컨텍스트가 공유
- **크지만 느림** (관리 오버헤드 있음)
- GC(Garbage Collector)가 자동으로 정리

### 📌 Static / Method Area (정적 영역)

- 클래스 메타정보, static 변수, 메서드 바이트코드 등이 저장됨
- 클래스가 로딩될 때 만들어져서 앱이 끝날 때까지 살아있음
- **언어마다 존재 여부와 의미가 다름** (이게 오늘의 포인트)

---

## 2. 세 언어 한눈에 비교

| 구분 | Java | JavaScript | Dart |
|---|---|---|---|
| Stack | ✅ | ✅ | ✅ |
| Heap | ✅ (GC) | ✅ (GC) | ✅ (GC, isolate별) |
| 별도 Static 영역 | ✅ Method Area | ❌ (Heap의 클래스 객체에 부착) | ✅ (lazy init) |
| top-level 변수 | ❌ (static 필드로 대체) | ✅ | ✅ |
| top-level 함수 | ❌ (static 메서드로 대체) | ✅ | ✅ |
| 함수가 1급 객체 | ⚠️ 함수 인터페이스 wrapper 필요 | ✅ 네이티브 | ✅ 네이티브 |
| 동시성 모델 | 공유 메모리 + 락 | 단일 스레드 + 이벤트 루프 | Isolate(메모리 격리) |
| 초기화 시점 | 클래스 로딩 시 즉시 | 선언 평가 시 | **Lazy** (첫 접근 시) |

---

## 3. Java 메모리 모델

### 특징 한 줄

> "엄격한 클래스 중심. 모든 게 클래스 안에, static은 별도 영역에."

### 메모리 영역

```
┌─────────────────────────────────────┐
│ Method Area (Metaspace)             │
│   - 클래스 메타정보                  │
│   - static 필드 (Counter.totalCount)│
│   - 메서드 바이트코드                │
└─────────────────────────────────────┘
┌─────────────────────────────────────┐
│ Stack (스레드별)                     │
│   - 메서드 호출 프레임                │
│   - 지역 변수, 원시 타입              │
│   - 객체 참조(주소)                  │
└─────────────────────────────────────┘
┌─────────────────────────────────────┐
│ Heap (모든 스레드 공유)              │
│   - new로 만든 모든 객체              │
│   - Young Gen → Old Gen 세대별 GC    │
└─────────────────────────────────────┘
```

### 예제 코드

```java
import java.util.function.BiConsumer;

class Counter {
    static int totalCount = 0;   // Method Area
    int value = 0;               // Heap (인스턴스 안)

    void increment(int amount) {
        int oldValue = value;    // Stack (지역 변수)
        value = oldValue + amount;
        totalCount++;
    }
}

public class App {
    static int multiplier = 2;   // Method Area

    static void boost(Counter c, int amount) {
        c.increment(amount * multiplier);
    }

    public static void main(String[] args) {
        Counter c1 = new Counter();                    // c1은 Stack, 객체는 Heap
        BiConsumer<Counter, Integer> action = App::boost;  // wrapper 객체는 Heap
        action.accept(c1, 5);
    }
}
```

### Java의 제약

- 클래스 밖에 변수를 못 둠 → `static` 필드로 우회
- 클래스 밖에 함수를 못 둠 → `static` 메서드로 우회
- 함수를 1급 객체처럼 다루려면 `BiConsumer`, `Function` 같은 **functional interface**로 wrap해야 함

---

## 4. JavaScript 메모리 모델

### 특징 한 줄

> "모든 게 Heap의 객체. 별도 Static 영역 자체가 없음."

### 메모리 영역

```
┌─────────────────────────────────────┐
│ Stack                                │
│   - 실행 컨텍스트(Execution Context) │
│   - 원시 타입 값                      │
│   - 객체 참조                        │
└─────────────────────────────────────┘
┌─────────────────────────────────────┐
│ Heap                                 │
│   - 객체, 배열, 함수, 클래스         │
│   - V8: Mark-and-Sweep GC            │
└─────────────────────────────────────┘
```

별도 Static 영역이 **없습니다**. 클래스 자체가 Heap에 있는 함수 객체이고, "static"이라고 표시된 것도 그 함수 객체의 일반 프로퍼티일 뿐이에요.

### 예제 코드

```javascript
class Counter {
    static totalCount = 0;    // Counter (Heap) 객체의 프로퍼티
    constructor() {
        this.value = 0;        // 인스턴스 (Heap) 객체의 프로퍼티
    }
    increment(amount) {
        let oldValue = this.value;  // Stack
        this.value = oldValue + amount;
        Counter.totalCount++;
    }
}

let multiplier = 2;            // 진짜 top-level (global 스코프)

function boost(counter, amount) {  // 함수 객체 (Heap)
    counter.increment(amount * multiplier);
}

const c1 = new Counter();
const action = boost;           // 같은 함수 객체를 가리키는 참조 하나 더
action(c1, 5);
```

### JavaScript의 자유로움

- **top-level 변수/함수를 그대로 선언 가능** — 클래스로 감쌀 필요 없음
- **함수가 진짜 1급 객체** — 변수에 그냥 할당하면 됨, wrapper 불필요
- 모든 게 객체라 reflection이 자연스러움 (`Object.keys`, `delete` 등)

---

## 5. Dart 메모리 모델

### 특징 한 줄

> "Java + JS의 절충안 + Lazy Init + Isolate 격리."

### 메모리 영역

```
┌─────────────────────────────────────┐
│ Static 영역 (lazy 초기화)            │
│   - top-level 변수                   │
│   - static 필드                      │
│   - 컴파일된 함수 코드               │
└─────────────────────────────────────┘
┌─────────────────────────────────────┐
│ Stack                                │
└─────────────────────────────────────┘
┌─────────────────────────────────────┐
│ Heap (isolate별 독립!)              │
│   - 객체, 클로저                     │
│   - generational GC                  │
└─────────────────────────────────────┘
```

### 예제 코드

```dart
class Counter {
    static int totalCount = 0;   // Static (lazy)
    int value = 0;               // Heap

    void increment(int amount) {
        int oldValue = value;
        value = oldValue + amount;
        totalCount++;
    }
}

int multiplier = 2;              // top-level 변수 (Static, lazy)

void boost(Counter counter, int amount) {  // top-level 함수
    counter.increment(amount * multiplier);
}

void main() {
    var c1 = Counter();          // new 키워드 생략 가능
    Function action = boost;     // 함수를 변수에 직접 (wrapper 불필요)
    action(c1, 5);
}
```

### Dart의 특별한 점

1. **Lazy Initialization**: `static`과 top-level 변수는 처음 접근될 때 초기화됨
   - 자바: 클래스 로딩 시 즉시 초기화
   - Dart: 첫 사용 시점까지 미룸 → 시작 시간 최적화
2. **Isolate 모델**: 각 isolate가 독립된 Heap을 가짐 → 메모리 공유 없음 → race condition 원천 차단
3. **모든 게 객체**: `int`, `bool`도 객체 (단 VM이 SMI 등으로 최적화)
4. **함수도 1급 객체**: 변수에 바로 담을 수 있음

---

## 6. ⚠️ 함정: static 키워드 ≠ static 메모리 영역

### 가장 헷갈리는 부분

JS에도 `static` 키워드가 **존재합니다**. 하지만 자바의 `static`과 의미가 완전히 달라요.

| 구분 | Java의 `static` | JavaScript의 `static` |
|---|---|---|
| 무슨 뜻? | "Method Area라는 **별도 영역**에 저장" | "이 속성은 **인스턴스가 아니라 클래스 객체 자체**에 속함" |
| 메모리 위치 | Method Area (Metaspace) | Heap (클래스 객체의 프로퍼티) |
| 강조하는 것 | **저장 위치** | **소속 관계** |
| 런타임 삭제 | 불가능 | `delete Counter.totalCount`로 가능 |
| reflection | 제한적 | `Object.hasOwn`, `Object.keys` 등 자유롭게 |

### JS의 `static`은 사실 이거랑 같아요

```javascript
// static 키워드 쓴 버전 (ES2022)
class Counter {
    static totalCount = 0;
    constructor() { this.value = 0; }
}

// 키워드 없는 ES5 버전 (메모리상 거의 동치)
function Counter() { this.value = 0; }
Counter.totalCount = 0;   // Counter 함수 객체에 그냥 프로퍼티 하나 추가
```

두 번째 버전이 본질을 잘 보여줘요. `Counter`는 함수(=객체)이고, 거기에 `totalCount`라는 키로 값을 매다는 것뿐.

### 직접 확인하기

```javascript
class Counter { static totalCount = 0; }

// Counter는 객체다
typeof Counter;                          // 'function'
Counter instanceof Object;               // true

// totalCount는 Counter의 자기 자신 프로퍼티
Object.hasOwn(Counter, 'totalCount');   // true
Object.getOwnPropertyNames(Counter);    // ['length', 'name', 'prototype', 'totalCount']

// 일반 객체 프로퍼티처럼 동작
Counter['totalCount'];                   // 0 (대괄호 표기 가능!)
Counter.totalCount = 99;                 // 그냥 할당
delete Counter.totalCount;               // 삭제 가능 ← 결정적 증거!
```

마지막 `delete`가 결정적이에요. **runtime에 삭제 가능 = 평범한 객체 프로퍼티**. 자바였다면 static 필드를 런타임에 지운다는 건 상상도 못할 일이죠.

### Dart의 `static`은?

Dart는 자바와 비슷하게 "별도 영역" 의미가 있지만, **lazy init**이 추가됩니다.

```dart
class Counter {
    static int totalCount = 0;  // Static 영역에 자리 잡힘
                                // 단, 처음 접근될 때까지 초기화 안 됨
}
```

---

## 7. 1급객체 함수 비교

### JavaScript - 네이티브 1급 객체

```javascript
function boost(...) { ... }
const action = boost;   // 함수를 변수에 할당 = 참조 복사
action(c1, 5);          // 호출
```

함수 자체가 Heap의 객체. `action`과 `boost`는 같은 객체를 가리키는 두 변수일 뿐. **추가 객체 생성 없음**.

### Java - functional interface wrapper

```java
BiConsumer<Counter, Integer> action = App::boost;
// 👆 JVM이 synthetic lambda 객체를 Heap에 새로 만듦
action.accept(c1, 5);
```

자바는 함수 자체를 1급으로 다룰 수 없어서 `BiConsumer`, `Function`, `Consumer`, `Supplier`, `Runnable` 같은 **functional interface**(@FunctionalInterface)로 감싸야 함. 이 wrapper 객체가 Heap에 생성됨.

### Dart - 네이티브 1급 객체 + tear-off

```dart
Function action = boost;  // 함수를 변수에 직접 할당
action(c1, 5);
```

Dart도 함수를 그대로 변수에 담을 수 있음. 내부적으론 "function tear-off"라는 메커니즘으로 closure가 만들어질 수 있지만 개념상 wrapper 불필요.

### 정리표

| 언어 | 함수를 변수에 담을 때 | 추가 객체 생성? |
|---|---|---|
| JavaScript | `const f = boost;` | ❌ (같은 객체 참조) |
| Java | `BiConsumer<...> f = App::boost;` | ✅ (lambda wrapper) |
| Dart | `Function f = boost;` | ⚠️ (VM이 tear-off로 처리, 보통 캐시됨) |

---

## 8. 클래스 밖 변수/함수 비교

| 언어 | top-level 변수 | top-level 함수 | 우회 방법 |
|---|---|---|---|
| Java | ❌ 불가 | ❌ 불가 | `static` 필드/메서드를 클래스 안에 |
| JavaScript | ✅ `let/const/var` | ✅ `function` 선언 | — |
| Dart | ✅ 직접 선언 (lazy) | ✅ 직접 선언 | — |

### 같은 의도, 다른 코드

```java
// Java - 클래스로 감싸야 함
public class App {
    static int multiplier = 2;
    static void boost() { ... }
}
```

```javascript
// JavaScript - 그냥 선언
let multiplier = 2;
function boost() { ... }
```

```dart
// Dart - JS처럼 자유롭지만 lazy init
int multiplier = 2;
void boost() { ... }
```

---

## 9. GC와 메모리 누수 공통 법칙

세 언어의 가장 큰 공통점: **개발자가 직접 메모리를 해제하지 않는 GC 언어**라는 것. C/C++처럼 `malloc`/`free`를 부를 일이 없습니다.

### 신경 써야 할 건 "참조를 끊는 것"

객체 자체를 해제할 게 아니라, **그 객체를 가리키는 참조를 모두 끊으면** GC가 알아서 정리합니다. 반대로 어딘가에서 계속 참조하고 있으면 GC가 손대지 못해요.

### 흔한 메모리 누수 패턴

| 언어 | 흔한 누수 사례 | 대응 |
|---|---|---|
| Java | static 컬렉션에 계속 add | 명시적 remove, WeakReference 사용 |
| JavaScript | 전역 변수, 이벤트 리스너 미제거, 클로저가 큰 객체 캡처 | `removeEventListener`, WeakMap |
| Dart | Stream 구독 미해제, 큰 객체 reference 보유 | `cancel()`, dispose 패턴 |

### 공통 모델

세 언어 모두 본질적으론 같은 모델이에요:

> **원시 타입은 Stack, 객체는 Heap, 변수는 객체를 가리키는 참조**

차이는 "어디까지를 객체로 보느냐"와 "static처럼 별도 영역을 두느냐"의 설계 결정일 뿐.

---

## 10. 최종 정리

### 한 줄 요약

- **Java**: 모든 걸 클래스에 가두고 static도 별도 영역에 분리. 함수도 wrapper로 감싸야 하는 **엄격한** 모델.
- **JavaScript**: 모든 게 Heap의 객체. `static` 키워드도 그저 "소속 표시"일 뿐. **유연한** 모델.
- **Dart**: Java와 비슷한 구조지만 **lazy init**과 **isolate별 독립 heap**이라는 자기만의 색깔. **절충+안전** 모델.

### static의 진짜 의미

| 언어 | `static` 키워드의 의미 |
|---|---|
| Java | "Method Area에 저장" (메모리 위치) |
| JavaScript | "클래스 객체 자신의 프로퍼티" (소속 관계) |
| Dart | "클래스 단위 공유" + "lazy init" |

### 함수가 1급 객체인가?

| 언어 | 답 |
|---|---|
| JavaScript | ✅ 네이티브, 그 자체가 객체 |
| Dart | ✅ 네이티브, tear-off 메커니즘으로 처리 |
| Java | ⚠️ 부분적, functional interface로 wrap해야 |

### 클래스 밖에 변수/함수를 둘 수 있나?

| 언어 | 답 |
|---|---|
| JavaScript | ✅ `let`, `function`으로 자유롭게 |
| Dart | ✅ 직접 선언 (lazy init) |
| Java | ❌ 무조건 클래스로 감싸야 (static 우회) |

---

## 참고

함께 만든 **메모리 시뮬레이터(`memory-simulator.html`)** 를 열어서 이 개념들이 실제로 어떻게 동작하는지 단계별로 확인할 수 있어요. 같은 단계 번호에서 세 탭을 바꿔보면 차이가 가장 잘 보입니다.

핵심 비교 포인트:
- **Step 2~3**: 클래스/top-level 변수가 어디에 만들어지는지
- **Step 5~6**: 함수를 변수에 담을 때 wrapper 객체가 생기는지 (Java) vs 안 생기는지 (JS, Dart)
- **마지막 step**: GC 대상이 되는 시점과 Static 영역에 남는 것들
