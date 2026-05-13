# Apache + Tomcat 아키텍처 가이드

> 시뮬레이터(`tomcat-simulator.html`)와 함께 보는 학습 자료

---

## 0. 한눈에 보는 큰 그림

```
[Browser]  ──HTTP──▶  [Apache HTTP Server]  ──AJP──▶  [Tomcat]  ──▶  [Servlet/JSP]
                            │                            │
                            ├─ 정적 (html/css/img)        ├─ Connector
                            │  → 직접 응답                 ├─ Thread Pool
                            │                            ├─ web.xml (Filter)
                            └─ 동적 (.jsp, /api/*)        ├─ Servlet
                               → Tomcat 위임              └─ Session Store
```

핵심 통찰 한 줄: **Apache는 빠르게 정적 파일을 쏴주는 데 특화되어 있고, Tomcat은 Java 코드(Servlet)를 실행하는 컨테이너다.** 둘을 같이 쓰는 이유는 "정적은 Apache, 동적은 Tomcat"으로 역할을 나눠 효율을 끌어올리기 위함이다.

---

## 1. 클라이언트 (Browser)

브라우저가 HTTP Request를 만들 때 들어가는 것들:

```
GET /users.jsp HTTP/1.1            ← Request Line
Host: app.example.com              ← Headers
User-Agent: Mozilla/5.0...
Cookie: JSESSIONID=ABC123...       ← 자동 첨부되는 쿠키
Accept: text/html

(body — POST일 때만)
username=admin&password=...
```

브라우저는 도메인에 저장된 쿠키를 **자동으로** 매 요청마다 첨부한다. 이게 세션 유지의 출발점.

---

## 2. Web Server (Apache / Nginx)

### 2.1 용어 정리 — Reverse Proxy의 두 가지 의미
"Reverse Proxy"라는 단어는 두 층위에서 쓰여서 헷갈리기 쉽다.

- **(a) 역할로서의 Reverse Proxy**: WAS 앞단에 서서 클라이언트 요청을 받아 적절한 백엔드로 전달하는 **서버 전체의 역할**. Apache/Nginx 서버 자체가 이 역할을 한다.
- **(b) 디렉티브/모듈로서의 Proxy Pass**: 그 서버 안에서 실제로 "이 URL은 저 백엔드로 보낸다"를 정의하는 **설정 메커니즘**. Apache의 `mod_proxy_ajp`, Nginx의 `proxy_pass` 디렉티브가 이에 해당.

즉 **(a)는 큰 그림에서의 역할**이고 **(b)는 그 역할을 실제로 구현하는 작은 부품**이다. 시뮬레이터에서는 헷갈림을 피하려고 (b)를 **"Proxy Pass"**라고 부른다.

```
                   ┌─────────────────────────────────────────┐
                   │ Web Server (= Reverse Proxy 역할)        │
[Browser] ──HTTP──▶│  ┌─────────┐ ┌────────────┐ ┌────────┐  │──▶ [WAS]
                   │  │Listener │ │ Static     │ │Proxy   │  │
                   │  │         │ │ Handler    │ │Pass(b) │  │
                   │  └─────────┘ └────────────┘ └────────┘  │
                   └─────────────────────────────────────────┘
                                  ↑(a) 전체가 Reverse Proxy
```

### 2.2 역할 (구현체 무관)
- **Listener**: 80/443 포트에서 TCP 연결 수락
- **Request Router**: 받은 URI를 설정된 매칭 규칙으로 분기
- **Static Handler**: `DocumentRoot` 폴더에서 파일을 직접 응답
- **Proxy Pass**: 매칭된 URL을 백엔드(WAS)로 포워딩 — 이게 곧 Reverse Proxy 동작의 핵심

### 2.3 Proxy Pass 구현체 매핑
"정적이냐 동적이냐"는 **사실 Web Server 입장에선 모르는 개념**이다. 설정 파일의 매칭 규칙만 본다. 매칭되면 백엔드로 보내고(Proxy Pass), 매칭 안 되면 자기가 정적 파일로 응답한다(Static Handler).

| Web Server | Proxy Pass 구현 | 백엔드 프로토콜 |
|---|---|---|
| Apache | `mod_proxy_ajp` | AJP (8009) |
| Apache | `mod_proxy_http` | HTTP (8080) |
| Apache | `mod_jk` (legacy) | AJP |
| Nginx | `proxy_pass` directive | HTTP / FastCGI / uwsgi |

설정 예시 (Apache, Nginx 둘 다):
```apache
# Apache
ProxyPass        /api/    ajp://localhost:8009/api/
ProxyPassMatch   "\.jsp$" ajp://localhost:8009
```
```nginx
# Nginx
location /api/    { proxy_pass http://localhost:8080; }
location ~ \.jsp$ { proxy_pass http://localhost:8080; }
```
이 매칭 규칙에 안 걸리는 URL은 `DocumentRoot` / `root`에서 파일로 직접 응답.

### 2.4 왜 Web Server를 WAS 앞에 두나?
- C로 짠 Apache/Nginx가 파일 I/O와 `sendfile` syscall에 매우 빠름
- Tomcat을 안 거치므로 Java 힙·GC·스레드 풀 부담 0
- SSL/TLS 종료, 로드 밸런싱, 캐싱, 압축 등을 Web Server 레벨에서 처리
- 결과: 트래픽의 절반 이상이 Tomcat에 닿지 않아 안정성·성능 ↑

> Spring Boot는 임베디드 Tomcat을 jar에 포함하므로 Web Server 없이도 동작한다. 대신 운영 환경에선 보통 그 앞에 Nginx를 둔다.

---

## 4. Tomcat 내부 구조

Tomcat은 크게 다음 계층으로 구성된다.

```
Server
 └── Service
      ├── Connector (요청 받기)
      └── Engine
           └── Host (가상호스트)
                └── Context (웹앱 = WAR)
                     └── Wrapper (Servlet 1개)
```

### 4.1 Connector — Tomcat의 입출구
Connector는 **요청을 받는 일**과 **응답을 내보내는 일**을 모두 담당한다. 그래서 안에는 두 개의 버퍼가 쌍으로 존재한다.

```
┌──────── Connector (Coyote 계층) ────────┐
│                                         │
│   Socket ──▶ [Request Buffer]  ──▶ Request 객체 ─┐
│                ├ Headers 영역                    │
│                └ Body 영역                    Servlet 실행
│                                                  │
│   Socket ◀── [Response Buffer] ◀── Response 객체 ┘
│                ├ Status + Headers 영역
│                └ Body 영역 (기본 8KB)
│                                         │
└─────────────────────────────────────────┘
```

**Request Buffer**
- 소켓에서 읽은 바이트를 헤더/바디로 파싱
- Header 영역: Request Line, 일반 헤더, Cookie 헤더
- Body 영역: POST/PUT 등의 페이로드 (GET은 비어있음)

**Response Buffer (기본 8KB)**
- 서블릿이 `response.getWriter().write(...)` 호출해도 즉시 클라이언트로 안 나감
- 일단 이 버퍼에 쌓임
- 버퍼가 차거나 `flushBuffer()` 호출 시 → **committed** 상태로 전환 → 그제서야 소켓으로 흘러나감
- **committed 후엔 헤더/상태코드 변경 불가** (이미 첫 청크가 나갔으므로)

```java
response.setBufferSize(16384);     // 버퍼 크기 변경 (committed 전에만)
response.getWriter().write("hi");  // 버퍼에 쌓임 (아직 클라이언트 X)
response.setHeader("X-Foo","v");   // ← 가능 (uncommitted)
response.flushBuffer();            // 강제로 비워서 전송 → committed
response.setStatus(500);           // ← 무시됨! 이미 committed
response.resetBuffer();            // body만 비우기 (committed 전)
response.reset();                  // 헤더까지 다 비우기 (committed 전)
```

**왜 응답 버퍼가 필요한가?** HTTP는 헤더 → 바디 순서로 보내야 한다. 첫 바이트가 나가는 순간 헤더는 확정되어 되돌릴 수 없다. 그래서 Tomcat은 응답을 일단 버퍼에 모아두고, 그 동안엔 서블릿이 "역시 에러로 바꿔야겠다", "헤더 하나 추가해야겠다" 같은 변경을 할 수 있게 해준다.

**버퍼는 그것만이 아니다**
```
서블릿 PrintWriter (내부 버퍼)
   ↓
Http11OutputBuffer (Tomcat, 기본 8KB) ← committed/uncommitted 개념
   ↓
OS TCP Send Buffer (커널, 64KB~256KB)
   ↓
NIC → 네트워크
```
write() 했다고 즉시 클라이언트가 받는 게 아니다. 3~4 계층의 버퍼를 거친다.

**Connector 구현체**
- **NIO (기본)**: 한 스레드가 여러 연결을 Selector로 폴링
- **APR**: Apache Portable Runtime (C 네이티브) — 가장 빠름
- **NIO2**: 비동기 I/O

### 4.2 Thread Pool — 가장 중요한 개념
Tomcat은 기본적으로 **1 Request = 1 Thread** 모델.

| 파라미터 | 의미 | 기본값 |
|---|---|---|
| `maxThreads` | 동시에 처리 가능한 최대 요청 수 | 200 |
| `minSpareThreads` | 항상 대기시키는 최소 스레드 수 | 10 |
| `acceptCount` | 풀이 꽉 찰 때 OS 큐 대기 크기 | 100 |
| `connectionTimeout` | 연결 유지 타임아웃 | 20000ms |

동작 흐름:
1. 요청 도착 → Connector가 받음
2. 풀에 idle 스레드 있으면 즉시 할당
3. 풀이 꽉 차면 **acceptCount 큐**에 대기
4. 큐도 꽉 차면 → **Connection Refused** (클라이언트가 에러 받음)

> **운영 팁**: `maxThreads`를 무작정 키우면 메모리·컨텍스트 스위칭 비용으로 오히려 느려진다. DB Connection Pool 크기와 균형을 맞춰야 함.

### 4.3 요청·응답 처리 순서 요약
```
1. 소켓에서 바이트 도착
2. Connector의 Request Buffer가 Header → Body 순으로 파싱
3. Thread Pool에서 Worker 스레드 할당
4. web.xml 필터 체인 → 서블릿 service() 호출
5. 서블릿이 Response 객체에 write — Response Buffer에 쌓임
6. flushBuffer() 또는 버퍼 full → committed → 소켓으로 전송
7. Worker 스레드는 Pool로 반환
```

---

## 5. web.xml — "문지기"

`web.xml` (또는 `@WebServlet` 어노테이션)은 **어떤 URL을 어떤 서블릿이 처리하는지**를 정의하는 배치 기술자.

```xml
<web-app>
  <!-- 필터 등록 -->
  <filter>
    <filter-name>EncodingFilter</filter-name>
    <filter-class>com.example.EncodingFilter</filter-class>
  </filter>
  <filter-mapping>
    <filter-name>EncodingFilter</filter-name>
    <url-pattern>/*</url-pattern>
  </filter-mapping>

  <!-- 서블릿 등록 -->
  <servlet>
    <servlet-name>LoginServlet</servlet-name>
    <servlet-class>com.example.LoginServlet</servlet-class>
  </servlet>
  <servlet-mapping>
    <servlet-name>LoginServlet</servlet-name>
    <url-pattern>/login</url-pattern>
  </servlet-mapping>
</web-app>
```

매칭 우선순위:
1. **Exact match**: `/login`
2. **Path prefix**: `/api/*`
3. **Extension match**: `*.jsp`
4. **Default**: `/` (DefaultServlet이 처리)

---

## 6. Filter Chain

서블릿 실행 **전후**로 끼어드는 인터셉터들. 책임 사슬 패턴.

```
Request ─▶ EncodingFilter ─▶ AuthFilter ─▶ LoggingFilter ─▶ Servlet ─▶ (역순 응답)
```

전형적 용도:
- **EncodingFilter**: UTF-8 강제
- **AuthFilter**: 세션/토큰 검증, 미인증이면 401
- **LoggingFilter**: 요청/응답 로깅
- **CompressionFilter**: gzip
- **CORS Filter**: 크로스 오리진 헤더

핵심: `chain.doFilter(req, res)`를 호출해야 다음 필터/서블릿으로 넘어간다.

---

## 7. Servlet 실행

### 7.1 생명주기
```
init()    ─ 클래스당 1회 (서버 시작 또는 첫 요청 시)
service() ─ 매 요청마다 호출 → doGet/doPost 등으로 분기
destroy() ─ 종료 시 1회
```
**서블릿은 싱글톤**이다. 여러 요청이 동시에 같은 인스턴스의 `doGet()`을 호출하므로 **인스턴스 변수는 thread-unsafe**.

### 7.2 GET vs POST
| 항목 | GET | POST |
|---|---|---|
| 파라미터 위치 | URL Query String | Request Body |
| 멱등성 | O (여러 번 호출해도 같은 결과) | X |
| 캐싱 | 가능 | 불가 |
| 크기 제한 | URL 길이 (~2KB) | 매우 큼 (수 MB) |
| 용도 | 조회, 검색 | 생성, 로그인, 파일 업로드 |

서블릿에서:
```java
protected void doGet(HttpServletRequest req, HttpServletResponse res) {
    String q = req.getParameter("q");           // Query String에서
}
protected void doPost(HttpServletRequest req, HttpServletResponse res) {
    String user = req.getParameter("username"); // Body에서 (자동 파싱)
    BufferedReader br = req.getReader();        // 원본 body 직접 읽기
}
```

---

## 8. Template Engine — HTML 렌더링 추상화

서블릿이 직접 HTML 문자열을 만들면 코드가 지저분해진다 (`out.println("<html>...")` 지옥). 그래서 **템플릿 파일**에 마크업을 두고, 서블릿은 **데이터만 전달**해서 렌더링을 위임한다. 이 위임 대상이 **Template Engine**.

```
[Servlet]               [Template Engine]
List<User> users  ──▶   users.mustache  +  data  ──▶  HTML 문자열  ──▶  Response Buffer
                        (캐시 우선 확인)
```

### 8.1 구현체 (Java 진영)
- **JSP** — Java EE 표준. `.jsp` → `.java` → `.class`로 컴파일. Jasper 엔진. 오래된 방식
- **Mustache** — Logic-less, 다른 언어와도 호환
- **Thymeleaf** — Spring 진영 표준. 자연 HTML (`<th:>` 속성)
- **Freemarker** — 강력한 표현식, 메일/문서 템플릿에도
- **Velocity** — 단순한 문법
- **Handlebars / Pebble / JTE** 등

### 8.2 공통 메커니즘 — 컴파일 + 캐시
모든 템플릿 엔진은 비슷한 패턴을 따른다:

```
[첫 요청]
  1. 템플릿 파일 읽기 (디스크 I/O)
  2. 파싱 → 내부 표현으로 컴파일 (AST나 Java 클래스로)
  3. 캐시에 저장
  4. 데이터 바인딩해서 렌더링
  → 수십~수백 ms 소요

[이후 요청]
  1. 캐시 히트
  2. 데이터 바인딩만 수행해서 렌더링
  → ms 단위
```

JSP는 이 "컴파일된 형태"가 실제 `.class` 파일로 디스크에 떨어진다. Mustache 같은 라이브러리형 엔진은 보통 메모리에만 컴파일된 AST를 보관.

### 8.3 운영 환경 팁
- **JSP는 사전 컴파일(precompile)** 해서 배포 → 첫 요청 지연 제거
- **개발 모드**: 파일 변경 감지해서 자동 재컴파일
- **운영 모드**: 파일 변경 감지 끄고 영구 캐시 → 성능 최적화
- 캐시는 LRU 등으로 관리, 너무 많은 템플릿이 있으면 메모리 부담

---

## 9. Session & Cookie — 상태 유지

HTTP는 stateless. 그래서 "이 요청이 누구로부터 왔는지"를 알려면 별도 메커니즘이 필요하다.

### 9.1 동작 흐름 (타이밍 주의!)
```
[1차 요청 — 예: POST /login]
  Browser ──▶ Tomcat
  ① Tomcat: Session 객체 생성 → Server Session Store에 즉시 저장
  ② 응답 헤더에 Set-Cookie: JSESSIONID=ABC123 추가
  ③ 응답 패킷이 Apache → Browser로 도달
  ④ ★ 이 시점에서야 Browser가 Set-Cookie를 읽고 쿠키 저장소에 저장 ★
     (응답 도착 전엔 브라우저는 JSESSIONID를 모름!)

[2차 요청 — 예: GET /users.jsp]
  Browser: 저장된 쿠키 JSESSIONID=ABC123 자동 첨부
  Browser ──▶ Tomcat
  Tomcat: Server Session Store에서 ABC123 찾아 Session 객체 복원
```

> **흔한 오해**: "세션이 만들어지면 브라우저에 바로 쿠키가 생긴다" — 틀림.
> 서버 메모리(Session Store)와 브라우저 쿠키 저장소는 **물리적으로 분리**되어 있고,
> 둘을 잇는 것은 **응답에 실린 Set-Cookie 헤더**뿐이다. 응답이 도착해야만 동기화된다.

### 9.2 Session 사용
```java
HttpSession session = req.getSession();  // 없으면 생성
session.setAttribute("user", "admin");
session.setAttribute("cart", cart);
String user = (String) session.getAttribute("user");
session.invalidate();  // 로그아웃
```

### 9.3 세션 저장 위치
- 기본: **Tomcat 메모리** (WAS 재시작 시 날아감)
- 대안:
  - 디스크 (FileStore)
  - Redis / Memcached — 가장 흔한 운영 패턴
  - DB
  - JWT로 stateless 전환 (세션 안 쓰기)

### 9.4 쿠키 보안
- `HttpOnly`: JS에서 접근 차단 → XSS 방어
- `Secure`: HTTPS에서만 전송
- `SameSite`: CSRF 방어 (Lax/Strict)

---

## 10. 응답의 여정 (역순)

```
Servlet
  └ response.getWriter().write("...") / response.setStatus(200)
     ↓
Tomcat Connector — HTTP 응답 메시지로 직렬화
     ↓
AJP → Apache mod_proxy_ajp
     ↓
Apache → 클라이언트 TCP 소켓
     ↓
Browser ← HTTP Response 파싱 후 렌더링
```

이때 Worker 스레드는 **Thread Pool로 반환**되어 idle 상태가 된다 (스레드는 재사용된다, 매번 만들지 않는다).

---

## 11. 자주 묻는 질문

### Q. Apache 없이 Tomcat만 써도 되나?
가능. Tomcat 자체에도 HTTP Connector(8080)가 있다. 다만:
- 정적 파일 처리 성능이 Apache보다 떨어짐
- SSL 종료, 로드밸런싱, 캐싱은 Apache/Nginx가 더 잘함
- 그래서 보통 **Nginx + Tomcat** 또는 **Apache + Tomcat** 구조로 간다.

### Q. Spring Boot는 Tomcat 어디서 돌아가나?
Spring Boot는 **임베디드 Tomcat**을 jar 안에 포함시킨다. `main()` 실행 시 Tomcat이 같이 뜸. 외부 web.xml은 필요 없고 어노테이션(`@RestController` 등)으로 등록.

### Q. Thread Pool이 꽉 차면?
1. 새 요청은 `acceptCount` 큐에서 대기
2. 큐도 차면 connection refused
3. 보통 원인은: 느린 DB 쿼리, 외부 API 대기, 무한 루프 → 한 스레드가 오래 점유
4. 대응: 비동기 처리, DB 쿼리 최적화, 서킷 브레이커, scale-out

### Q. 1 Request = 1 Thread를 깰 수 없나?
Servlet 3.0+의 **Async Servlet** 또는 Spring WebFlux로 **이벤트 루프 모델** (Netty 기반)을 쓰면 한 스레드로 수많은 연결을 다룰 수 있다. I/O 대기가 많은 워크로드에서 유리.

---

## 12. 시뮬레이터 사용법

`tomcat-simulator.html`을 브라우저로 열면 됩니다.

### 버튼별 시연 시나리오
| 버튼 | 시연 포인트 |
|---|---|
| `GET /index.html` | 정적 — Web Server의 Static Handler가 바로 응답, Tomcat 안 거침 |
| `GET /logo.png` | 정적 — MIME만 이미지 |
| `GET /login-form` | 동적 GET — Proxy Pass로 Tomcat 전달, Template Engine으로 `login.mustache` 렌더링 (첫 호출 시 컴파일, 이후 캐시) |
| `POST /login` | 실제 로그인 — Body 파싱, 서버 Session Store에 세션 생성, Set-Cookie 응답 |
| `POST /api/users` | 보호 자원 — 세션 쿠키 없으면 AuthFilter가 401로 차단, 있으면 UsersServlet.doPost() 실행 |

### 관찰 포인트
1. **정적 요청**은 Web Server의 Static Handler에서 멈춤 — 패킷이 Tomcat까지 안 감, Tomcat 버퍼도 비어있음
2. **Request Buffer** (왼쪽 파란 박스): 동적 요청 시 Header가 먼저 채워지고, POST면 Body까지 적재
3. **Response Buffer** (오른쪽 주황 박스): 서블릿/템플릿 실행 후 Status+Headers, 그 다음 Body가 차례로 채워짐. 이때 `uncommitted` 상태 유지
4. **COMMITTED 배지**가 초록으로 바뀌는 순간이 진짜 응답이 소켓으로 흘러나가는 시점 — 그 전엔 헤더 변경 가능
5. **패킷에 표시되는 정보**: 요청 패킷엔 들고 가는 `🍪 JSESSIONID...`, 응답 패킷엔 `🍪 Set: ...` (Set-Cookie) 또는 `sid: ...` (기존 세션 식별자)
6. `POST /api/users`를 로그인 안 한 상태에서 누르면 → AuthFilter에서 차단되어 **빨간 401 패킷**이 돌아옴 (Servlet/Template/비즈니스 로직 모두 미실행). 로그인 후 다시 누르면 정상 처리됨
7. `GET /login-form`을 두 번 눌러보면 첫 번째는 `login.mustache` **컴파일 + 캐시 저장** (초록 `compiled` 배지 점등), 두 번째는 **캐시 히트** 로그
8. `POST /login` 시: 서버 Session Store에 **즉시** 세션 생성, 응답 헤더에 `Set-Cookie` 표시되지만 브라우저 쿠키 영역은 **분홍 패킷(🍪)이 브라우저에 도착한 순간**에 비로소 채워짐
9. **로그인 후 요청**의 Request Buffer Header 영역엔 `Cookie: JSESSIONID=...` 라인이 자동 첨부됨
10. **Thread Pool**의 T0~T7 중 하나가 잠깐 초록색(busy)이 됐다가 다시 회색(idle)으로
11. **⏸ 일시정지 버튼** 또는 **Space 키**로 애니메이션 중간에 일시정지·재개 가능 (애니메이션 중에도 일시정지 클릭 가능)

---

## 13. 부하 상황별 클라이언트(브라우저) 경험

Tab 2 시뮬레이터의 시나리오 프리셋과 매칭됩니다. 서버 측면의 메트릭은 시뮬레이터에서 보고, 같은 상황에서 **클라이언트(브라우저)에선 무엇이 보이는지**를 정리합니다.

### 13.1 정상 운영 (여유 상태)
> 시뮬레이터 프리셋: **여유** — 4 users / 8 threads / queue 4

**서버 상태**
- Thread Pool: 30~50% 사용
- Queue: 항상 비어있음
- 거부 0

**브라우저 동작**
- 응답시간: `proc time` 그대로 (예: 500ms)
- HTTP 상태: 항상 `200 OK`
- 페이지/리소스가 빠르게 로드, 스피너 잠깐 보이고 끝
- 모든 AJAX 호출 정상 성공

**사용자 인식**: "빠르네 / 정상이네"

---

### 13.2 풀 포화 직전 (큐 대기 없음)
> 시뮬레이터 프리셋: **포화 직전** — 8 users / 6 threads

**서버 상태**
- Thread Pool: 90~100% (활성 스레드 5~6개 / 6)
- Queue: 거의 비어있다가 가끔 1~2개
- 거부 0

**브라우저 동작**
- 응답시간: `proc time` + 가끔 짧은 큐 대기 (대부분 500ms, 가끔 700~800ms)
- HTTP 상태: 모두 `200 OK`
- 페이지 정상 로드, **체감 차이는 거의 없음**
- 단, 응답시간의 표준편차가 커짐 (p99이 평균보다 살짝 높아지기 시작)

**사용자 인식**: 일반 사용자는 못 느낌. 민감한 사용자만 "오늘 좀 답답한가?"

---

### 13.3 큐 대기 발생 (Latency 악화)
> 시뮬레이터 프리셋: **큐 대기 발생** — 12 users / 6 threads / queue 6

**서버 상태**
- Thread Pool: 항상 100% (6/6)
- Queue: 채워졌다 비워졌다 반복, 평균 3~6개 점유
- 거부 0 또는 극소수

**브라우저 동작**
- 응답시간:
  - 새 요청은 큐에 들어가 대기 → **큐 대기 시간 + 처리 시간**
  - 500ms 처리가 1.5초, 2초, 3초까지 늘어남
  - p95이 1초 넘어가고 p99은 2~3초
- HTTP 상태: 여전히 `200 OK` (단지 느릴 뿐)
- 브라우저 스피너가 오래 돌아감 → 사용자가 "왜 안 떠?" 함

**브라우저 특유의 연쇄 효과**
- 브라우저는 **같은 호스트로 최대 6개 연결**(HTTP/1.1 기본)만 동시 사용
- 그 6개가 모두 느린 응답을 기다리면 **다른 새 요청은 브라우저 내부 큐에서 또 대기**
- 페이지 로드 시 여러 리소스(JS, CSS, API)가 같이 가져와지는데, 일부가 막히면 페이지 전체 렌더가 멈춘 듯 보임
- AJAX 호출 여러 개를 보낸 SPA에선 일부는 빨리 오고 일부는 늦게 와서 화면이 chunked로 나타남

**사용자 인식**: "느리다 / 버벅거린다 / 멈춘 것 같다"

---

### 13.4 큐 오버플로우 (Connection Refused 폭주)
> 시뮬레이터 프리셋: **거부 폭주** — 20 users / 2 threads / queue 2

**서버 상태**
- Thread Pool: 100% (2/2)
- Queue: 100% (2/2)
- 거부 카운터 계속 증가

**서버가 거부할 때 일어나는 일** (두 가지 경로)

**(a) TCP 레벨 거부 (acceptCount 초과)**
- Tomcat의 OS 백로그 큐도 꽉 차서 **소켓 자체를 거부** (RST 또는 connection timeout)
- 브라우저에 `net::ERR_CONNECTION_REFUSED` 표시
- "사이트에 연결할 수 없음" 류 페이지

**(b) 502 / 503 응답 (Web Server 또는 LB가 못 견딤)**
- 앞단 Nginx/Apache가 백엔드 timeout 또는 unavailable 감지
- 클라이언트에게 `502 Bad Gateway` 또는 `503 Service Unavailable` 반환
- `Retry-After` 헤더에 권장 재시도 시간이 들어갈 수도 있음

**브라우저 동작**
- 일부 요청은 통과 (200 OK), 일부는 실패 (502/503/connection refused)
- **무작위로** 성공/실패가 섞임 → 디버깅 가장 어려운 상태
- SPA의 경우: 페이지 자체는 떴는데 일부 API만 빨갛게 깨짐
- 사용자가 새로고침 누르면 또 일부만 됨

**사용자 인식**: "사이트가 망가졌다 / 어떤 페이지는 되고 어떤 페이지는 안 된다"

**브라우저는 자동 재시도하지 않음** — 사용자가 새로고침해야 함 (단, 일부 fetch 라이브러리는 자체 재시도 로직 가질 수 있음)

---

### 13.5 슬로우 쿼리 시나리오
> 시뮬레이터 프리셋: **슬로우 쿼리** — 12 users / 6 threads / 30% slow

**서버 상태**
- 슬로우 요청 (proc time × 3 = 1.5초 정도)이 Thread Pool 자리를 오래 점유
- 정상 빠른 요청들도 그 동안 남은 스레드에서 처리 → 가용 스레드가 사실상 적어짐
- 큐 대기 발생, 일부 거부

**브라우저 동작**
- **응답시간 분포가 두 봉우리(bimodal)**
  - 운 좋은 요청: 평상시 속도 (~500ms)
  - 운 나쁜 요청: 슬로우 쿼리를 만난 큐 자리에 들어감 → 2~5초
- p50은 정상, **p95/p99이 극단적**
- HTTP 상태: 대부분 200 OK, 일부 timeout 가능

**사용자 인식이 가장 답답한 시나리오**
- "어떨 땐 빠르고 어떨 땐 느리다"
- 새로고침하면 잘 됨 → 재현이 안 되는 듯 보임
- 사실은 운에 따라 다른 큐 자리에 들어가는 것
- 운영자가 "재현이 안 돼요" 듣는 가장 흔한 케이스

---

### 13.6 추가 알아두면 좋은 브라우저 동작

**Connection Limit (호스트당 동시 연결 수)**
- HTTP/1.1: 보통 6개 (브라우저별 다름)
- HTTP/2: 1개 연결로 multiplexing (해결됨)
- HTTP/3 (QUIC): UDP 기반, 더 효율적

**자동 재시도?**
- 브라우저는 일반적으로 **자동 재시도하지 않음**
- GET이라도 자동 재시도 안 함 (idempotent여도)
- 단, DNS 실패나 일부 네트워크 에러는 자동 복구 시도 가능
- 페이지 로드 중 일부 리소스 실패 → 페이지의 다른 부분은 정상

**HTTP Timeout**
- 브라우저 기본: 보통 무한 (또는 매우 김, 분 단위)
- OS 레벨 TCP timeout: ~75초 ~ 수분
- `fetch()` API: 기본 timeout 없음 (AbortController로 설정 가능)
- 프록시/CDN: 보통 30~60초 timeout 설정

**Keep-Alive 영향**
- HTTP/1.1은 기본 keep-alive → 같은 호스트에 여러 요청 시 연결 재사용
- 연결이 막혀있으면 다음 요청도 그 연결에 묶임
- 슬로우 쿼리가 keep-alive 연결을 점유하면 같은 연결의 다음 요청도 대기

**캐싱 / Service Worker 영향**
- 정적 리소스는 브라우저 캐시 사용 → 서버 폭주와 무관하게 빠름
- Service Worker로 stale-while-revalidate 패턴 쓰면 오프라인이나 폭주 시 캐시로 응답 가능

---

### 13.7 운영 대응 (서버측에서 클라이언트 경험 개선)

| 증상 | 대응 |
|---|---|
| 큐 대기로 응답 느림 | `maxThreads` 증가 (메모리 한도 내), 비동기 처리 도입 |
| Connection Refused 발생 | `acceptCount` 늘리거나 LB로 분산, scale-out |
| 슬로우 쿼리가 풀 점유 | 쿼리 최적화, 별도 풀 분리, 서킷 브레이커 |
| p99 레이턴시 높음 | Slow query 추적, DB 인덱스, 캐시 도입 |
| 503 응답 시 클라이언트가 그냥 실패 | Nginx에서 `Retry-After` 헤더 추가, 클라이언트 재시도 로직 |
| 일부 요청만 실패하는 미스터리 | 부하 시점 메트릭 확인 (RPS, p99, queue depth) — bimodal 분포 의심 |

> 정리: 클라이언트가 보는 증상은 **(1) 같이 느림**, **(2) 일부만 실패**, **(3) 가끔만 느림** 셋 중 하나로 압축된다. 그 중 (3)이 가장 진단이 어렵다.

---

## 부록: 핵심 용어 정리

| 용어 | 한 줄 설명 |
|---|---|
| Servlet | Java로 HTTP 요청을 처리하는 클래스 |
| JSP | HTML에 Java를 섞은 것. 결국 서블릿으로 컴파일됨 |
| Container | 서블릿 생명주기를 관리하는 런타임 (= Tomcat) |
| Connector | 외부 통신을 받아 내부 Engine으로 넘기는 컴포넌트 |
| Engine / Host / Context | Tomcat의 계층 구조 (서버 → 가상호스트 → 웹앱) |
| Filter | 서블릿 호출 전후로 끼어드는 인터셉터 |
| web.xml | URL→서블릿 매핑·필터 등록 설정 파일 |
| AJP | Apache↔Tomcat 통신 바이너리 프로토콜 |
| JSESSIONID | Tomcat이 세션 식별용으로 발급하는 쿠키 이름 |
| WAR | 웹앱 배포 단위 (Tomcat의 webapps/ 폴더에 떨어뜨림) |
