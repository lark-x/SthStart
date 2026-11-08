# Python 测试基础教材

更新时间：2026-11-06  
适用对象：会写一些业务代码，已经接触 pytest 和接口测试，希望把基础知识补扎实的学习者。  
学习方式：先理解例子，再独立做小练习；需要时请求方向、局部提示或参考答案。

总教材为 [软件测试基础](SOFTWARE_TESTING_FOUNDATIONS.md)，覆盖前后端、数据库、自动化、AI 与测试设计；本文专门补充 Python、HTTPX 和 pytest 写法。

## 这份教材怎么学

你已经接触了真实接口、fixture 和提案状态测试。这份教材从这些经历出发，解释“代码为什么这样写”和“测试为什么这样判断”。它不要求你重做所有入门操作。

阅读时遇到代码，先预测运行结果，再运行验证。遇到失败，先说出自己预期什么、实际得到什么，再改代码。下面的小例子主要使用内存中的固定数据；涉及项目网络请求时，继续使用独立测试服务和临时数据库。

推荐分四批学习，不必一天读完：

| 批次 | 章节 | 学习结果 |
| --- | --- | --- |
| 一 | 1—3 | 能设计一个有明确判断依据的用例 |
| 二 | 4—8 | 能看懂并修改测试中的 Python 常用语法 |
| 三 | 9—12 | 能解释 HTTP/JSON、pytest、fixture 与参数化 |
| 四 | 13—17 | 能管理资源、定位失败，并独立完成一个小测试 |

后续项目练习见 [Story 完整指南](STORY_VERTICAL_TESTING_GUIDE.md)，重构后的入口见 [重构更新清单](FRONTEND_REFACTOR_TEST_UPDATE.md)。学习记录统一放在 [学习进度](LEARNING_PROGRESS.md)。

## 1. 测试到底在检查什么

### 1.1 从“能运行”到“行为正确”

程序没有崩溃，只能说明这次执行没有遇到使程序停止的错误。测试还要判断它的行为是否符合约定。

例如保存章节后，页面显示了新正文，仍可能有三种情况：只改了输入框、只保存在浏览器本机、已经写入服务端。你的目标如果是“保存到服务端”，就必须观察服务端重新读取的结果。

一条测试可以拆成五个问题：

1. 先决条件是什么？例如已有独立项目和章节。
2. 输入是什么？例如把正文 A 改成 B。
3. 执行什么操作？例如发送一次更新请求。
4. 应该观察什么？例如响应成功，重新读取得到 B。
5. 根据什么判定？例如接口契约和版本更新规则。

“满足需求”是方向，真正写测试时还需要把需求变成可比较的数据：具体状态码、错误码、正文、版本或页面状态。

### 1.2 Arrange–Act–Assert

这三个词对应准备、执行、断言，常简写为 AAA：

```python
def test_strip_removes_outer_spaces():
    # Arrange：准备
    source = "  学习章节  "

    # Act：执行
    actual = source.strip()

    # Assert：判断
    assert actual == "学习章节"
```

`strip()` 是这里的被测操作；`actual` 是观察结果；右侧字符串是预期。你不需要给每条测试都写三行注释，但阅读者应能辨认这三个部分。

在真实项目里，fixture 可能承担准备动作。准备动作被提取后仍要知道它创建了什么，否则容易把准备数据出错误判成被测功能出错。

### 1.3 通过和失败分别说明什么

通过表示本次实际执行的断言成立，不代表其他输入、其他模块或未写的行为也正确。失败表示预期与观察不一致，需要进一步分辨：程序问题、测试错误、准备数据错误，还是环境没有就绪。

没有断言的函数可能显示通过；只断言固定示例字典也可能通过。这些结果不能证明真实系统行为。问自己：如果系统没有保存 B，这条测试会失败吗？如果不会，测试还缺关键观察。

## 2. 测试的几种层次

| 层次 | 常见验证对象 | 例子 | 主要代价 |
| --- | --- | --- | --- |
| 单元测试 | 小函数或局部规则 | 标题清理函数 | 范围小，不能证明多层连接 |
| 集成测试 | 多个真实组件的协作 | HTTP 路由、权限、数据库写入 | 要准备服务和数据 |
| 浏览器测试 | 页面中的用户行为 | 输入、保存、刷新 | 启动较慢，要处理等待与定位 |
| 端到端测试 | 完整业务路径 | 页面保存→MCP 提案→作者接受 | 失败来源多，定位成本较高 |
| 模型评估 | 模型输出与工具行为质量 | 连贯性判断是否有证据 | 有波动，还需要人工评分 |

你目前用 httpx 调真实 Service 的测试通常属于接口集成测试。一次 HTTP 请求可能同时经过路由、认证、校验和数据库，不宜仅因函数短就叫单元测试。

同一个行为可在不同层验证：API 检查版本冲突规则，浏览器检查冲突提示和草稿保留。浏览器层没有必要重复所有字段组合，先让低层测试覆盖明确规则，再用少量完整流程保护层间连接。

MCP 是工具发现与调用的协议；Skill 是对模型如何做任务的指导。直接通过 MCP 客户端读取章节可以做确定性测试；模型是否按 Skill 正确分析资料，则需要另外设计评估。

## 3. 怎样设计用例

### 3.1 正常、异常和边界

正常场景验证合理输入能成功；异常场景验证无权限、格式错误、版本过期等情况被正确处理；边界场景检查规则刚好发生变化的位置。

假设某字段约定长度为 1—120，可先选择 0、1、120、121 四种长度。它们对应下界之外、下界、上界、上界之外。这个数字是设计方法示例；实际字段的上限要核对本项目当前契约。

空字符串、缺少字段和 `null` 是不同输入，服务端可能分别处理：

```python
empty_title = {"title": ""}
missing_title = {}
null_title = {"title": None}
```

### 3.2 等价类

把预计遵循同一规则的输入分组，从每组选择代表值。例如标题长度在有效范围内的大量字符串，可能属于同一类；过短、过长、错误类型分别是其他类。

等价类减少重复，不保证组内所有输入永远等价。若发现换行、Unicode 或特殊字符触发额外规则，就再拆分具体类别。先依据明确约定设计，不随机堆一百个值。

### 3.3 状态变化

提案不仅有输入，还有原状态。相同“接受”操作，对 pending、rejected、过期 pending 的结果不同。因此用例要写清起始状态和操作顺序。

```text
创建章节版本 N
→ 创建依据 N 的提案
→ 作者保存章节为 N+1
→ 尝试接受旧提案
→ 应拒绝覆盖，并保留 N+1
```

如果先更新章节再创建提案，你验证的是另一条规则。错误码相同或 HTTP 状态相同，也不能自动说明场景相同。

### 3.4 正向结果和副作用

成功用例检查“该发生的变化发生了”；失败用例也要检查“不该发生的变化没有发生”。更新失败后只检查 409，仍不足以证明数据没被错误覆盖，要再 GET 正式正文和版本。

写用例前先填这个小表：

| 条目 | 你要写的内容 |
| --- | --- |
| 目标 | 用一句话描述保护什么行为 |
| 准备 | 项目、章节、权限和起始版本 |
| 操作 | 当前用例真正测试的请求或页面操作 |
| 响应 | 状态码与必要字段 |
| 最终状态 | 重新读取的数据应该是什么 |
| 判断依据 | 当前契约、业务规则或页面约定 |

## 4. Python 从哪里运行

### 4.1 解释器与虚拟环境

Python 解释器负责执行 `.py` 文件。虚拟环境把本次学习需要的 Python 依赖放进独立目录，减少与其他项目的依赖冲突。

你当前使用的解释器是 `tests/python/.venv/Scripts/python.exe`。在仓库根目录执行：

```powershell
.\tests\python\.venv\Scripts\python.exe -m pytest tests/python/test_health.py -v
```

`-m pytest` 表示让这个解释器运行 pytest 模块；`tests/python/test_health.py` 是选择的文件；`-v` 让输出显示更详细的用例名。用同一个解释器执行 `-m pip`，安装的包才会进入同一个环境。

终端前面显示 `(.venv)` 是激活提示，但出现依赖问题时仍应检查实际解释器。VS Code 选择的解释器与另一个 PowerShell 终端使用的解释器可能不同。

### 4.2 当前目录、文件路径与导入

相对路径依赖当前工作目录。`Path.cwd()` 返回启动时的工作目录；`Path(__file__)` 指向当前模块文件。这两者不能混为一谈。指南中的命令统一从 `F:/Project/SthStart` 执行。

`import httpx` 加载第三方模块；`from pathlib import Path` 从标准库模块导入某个名称。导入模块时，文件顶层语句会执行。真实网络请求应放进函数、fixture 或明确的脚本入口，不要让 pytest 刚收集文件时就发请求。

## 5. Python 常用数据类型

### 5.1 变量与基本类型

```python
title = "学习章节"       # str：字符串
revision = 3            # int：整数
timeout = 5.0           # float：浮点数
saved = True            # bool：布尔值
proposal = None         # None：这里表示尚无对象
```

变量名帮助你记住值的含义。`=` 把右侧值绑定到左侧名称；它不做比较。字符串要有引号；`True`、`False`、`None` 首字母大写且不带引号。

`"3"` 和 `3` 类型不同，比较不相等。接口中的 revision 通常应该是数字，不能因为输出长得一样就当成同一种值。可用 `type(value)` 临时观察类型，用 `isinstance(value, str)` 检查是否符合需要的类型。

### 5.2 字典 dict

```python
chapter = {
    "id": "chapter-demo",
    "title": "学习章节",
    "body": "原正文",
    "revision": 3,
}
```

字典用键关联值。`chapter["body"]` 取正文；`chapter["body"] = "新正文"` 修改这个本地字典。修改本地字典不会自动发送 HTTP 请求，也不会自动修改服务端。

`chapter["missing"]` 在键不存在时抛 `KeyError`；`chapter.get("missing")` 返回 `None`；`chapter.get("missing", "默认值")` 返回指定默认值。必需字段通常用方括号明确检查，避免 `.get()` 把缺字段悄悄变成空值。

### 5.3 列表 list 和元组 tuple

```python
statuses = ["pending", "accepted", "rejected"]
case = ("空标题", "", 400)
```

列表用方括号，适合保存多个条目，可以增加或修改元素。元组用圆括号，适合表示固定的一组值，不能像列表那样替换其中元素。

索引从 0 开始，所以 `statuses[0]` 是 pending。`len(statuses)` 为 3。空列表取第 0 项会抛 `IndexError`。API 返回的列表顺序若没有契约保证，就不能用第一项定位目标章节。

### 5.4 集合 set

```python
required = {"read_entry", "submit_proposal"}
available = {"read_entry", "submit_proposal", "search_entries"}
assert required <= available
```

集合表示不重复的成员，不用来依赖显示顺序。这里的 `<=` 表示子集：required 的每个名字都存在于 available。工具列表允许增加其他工具时，这比检查总数量固定为 2 更合理。空集合写 `set()`；`{}` 是空字典。

### 5.5 可变对象与快照

```python
before = chapter
chapter["body"] = "本地改动"
```

这时 before 与 chapter 指向同一字典，before 也会看到本地改动。`before = chapter.copy()` 会复制外层字典，但若内部还有列表或字典，内部对象仍可能共享。

测试记录快照时，优先保留明确字段，例如原正文字符串、原 revision 整数。HTTP 响应解析出的旧字典不会随数据库自动更新；操作后必须重新请求，获取新的观察值。

## 6. 条件、循环与查找

### 6.1 if 与布尔条件

```python
if response.status_code == 200:
    payload = response.json()
else:
    payload = None
```

`if` 后面的条件为真就执行第一段，否则执行 else。测试里不要用这种分支把失败绕开：例如“只有返回 200 才断言，其他状态什么都不做”，会使错误响应也显示通过。若本来就期望 200，应直接断言状态。

`and` 要求两侧都满足，`or` 允许至少一侧满足，`not` 取反。注意 `status == 200 or 201` 并不是“200 或 201”；数字 201 本身是真值，整个条件可能总为真。应写 `status in (200, 201)`，并确认业务真的允许两种状态。

### 6.2 普通循环查找目标

```python
found = None
for item in items:
    if item["id"] == target_id:
        found = item
        break

assert found is not None
```

先用 None 表示还没找到；for 依次取出列表元素；匹配 ID 后赋值给 found；break 结束循环。遍历结束仍为 None，就说明没有匹配。最后断言要先于 `found["body"]`，避免拿空值取字段。

### 6.3 推导式与 next

```python
matching = [item for item in items if item["id"] == target_id]
found = next((item for item in items if item["id"] == target_id), None)
```

第一行是列表推导式，会建立包含所有匹配项的新列表；第二行圆括号里是生成器表达式，按需产生匹配项，next 取得第一个。next 的第二个参数 None 是没找到时的默认值；省略默认值，没找到会抛 `StopIteration`。

若约定 ID 唯一，可以按目标 ID 查找；若还要证明列表没有重复项，可以检查 matching 长度为 1。使用简写前先能解释普通循环，不必追求最短代码。

## 7. 函数、参数与返回值

### 7.1 定义和调用

```python
def make_title(prefix, suffix):
    return f"{prefix}-{suffix}"

title = make_title("pytest", "demo")
```

def 定义函数；prefix/suffix 是参数；调用时传入的两个字符串是实参；return 把结果返回。f-string 的花括号把变量值插进字符串。没有执行到 return 的函数默认返回 None。

`make_title(prefix="pytest", suffix="demo")` 是关键字传参，按参数名指定值；普通位置传参按顺序对应。混用时位置参数通常要写在关键字参数之前。

### 7.2 普通函数和测试函数

普通函数适合复用准备数据、解析响应等步骤。测试函数由 pytest 收集，负责描述被保护行为。不要在一个测试中调用另一个 `test_` 函数来准备数据，应抽出普通 helper 或 fixture。

辅助函数如果规定“创建成功并返回对象”，可以检查成功状态；测试失败场景的请求则应保留原始 response，让用例检查预期错误。不要让成功 helper 提前阻止你观察错误响应。

### 7.3 类型提示和装饰器

`def find_title(item: dict) -> str:` 中的注解表示参数预计是字典、结果预计是字符串。它帮助编辑器和读者理解，不会自动校验或转换输入。

`@pytest.fixture`、`@pytest.mark.parametrize(...)` 是装饰器写法。Python 在定义函数时把该函数交给装饰器处理；pytest 用这些声明获得 fixture、参数案例或标记信息。先学会正确使用即可，当前不要求自己实现装饰器。

## 8. 断言怎么写才有效

### 8.1 assert 是立即检查

```python
assert response.status_code == 200
assert payload["status"] == "pending"
assert isinstance(payload["items"], list)
```

assert 后面的表达式为假时抛出 AssertionError，pytest 报告失败并展示有关值。它不会持续等待页面变化；页面自动等待要使用 Playwright 的 expect，后续再学。

`assert value` 检查真值。None、False、0、空字符串、空列表、空字典都属于假值。因此 `assert revision` 只证明不是 0/空值，不证明版本正好为 3。按业务需要写准确比较。

### 8.2 ==、is、in 的区别

`==` 比较值，`is` 比较是否是同一个对象。字符串内容比较用 `==`，空值用 `is None` 或 `is not None`。`in` 检查成员：对字典是检查键，对列表是检查元素，对字符串是检查子串。

`assert "正文" in response.text` 只能证明文字出现在整个响应中，可能在错误消息或别的条目里。对于有结构的 JSON，应解析后按目标字段检查。

### 8.3 避免自己证明自己

```python
expected = "新正文"
actual = expected
assert actual == expected
```

这段一定通过，但没观察系统。真实 actual 要来自函数返回、HTTP 响应、重新读取的数据或页面。预期值与实际值要有各自来源。

失败后的数据检查同样不能使用操作前的旧字典；先重新 GET，再比较旧值和新读回值。

## 9. HTTP 与 JSON 基础

### 9.1 一次请求包含什么

HTTP 请求通常有方法、URL、请求头和可选正文。URL 又包含协议、地址、端口、路径和可选查询参数。例如 `http://127.0.0.1:4800/api/v1/health` 中，4800 是端口，后面是路径。这里是结构示意，当前服务真实地址由测试 fixture 返回。

| 方法 | 常见用途 | 本项目例子 |
| --- | --- | --- |
| GET | 读取 | 文档列表 |
| POST | 新建或执行明确动作 | 创建提案、决定提案 |
| PUT | 更新指定资源 | 保存章节 |
| DELETE | 删除或撤销已定义资源 | 撤销 bridge grant |

HTTP 方法有常见语义，但哪些路径真实存在、具体返回什么，要看契约和路由；不能因为能 POST 项目，就猜测项目 DELETE 一定存在。

### 9.2 状态码与业务错误码

200 表示成功处理；201 常用于成功创建；204 表示成功且没有响应正文；400 通常是输入不符合约定；401 表示缺少或无效认证；403 通常表示已识别身份却无权限；404 是目标或路由不存在；409 是当前资源状态冲突；5xx 表示服务端处理出现问题。

这些是常见语义，实际接口可能采用自己的认证错误策略。测试要依据本项目契约，不能仅凭个人习惯要求所有服务行为一致。204 没有正文时不要调用 `.json()`。

同一个 409 可以代表不同业务原因。除了状态，还要检查 `response.json()["error"]`，并检查失败后状态。不要把中文 message 的全部措辞作为稳定契约，除非需求明确要求它精确匹配。

### 9.3 Python 与 JSON 的对应

JSON object/array 对应 Python dict/list；JSON true/false/null 对应 Python True/False/None。JSON 是文本格式，字典是 Python 内存对象。

```python
import json

encoded = json.dumps({"title": "章节", "enabled": True}, ensure_ascii=False)
decoded = json.loads(encoded)
```

dumps 把对象编码成 JSON 字符串，loads 把 JSON 字符串解析成 Python 值。ensure_ascii=False 让中文保留为中文形式。传输格式不正确时解析会抛异常，不能继续假设得到了字典。

### 9.4 HTTPX 的 response 和 payload

```python
response = client.get("/api/v1/health")
assert response.status_code == 200
payload = response.json()
assert payload["status"] == "ok"
```

client 是 HTTP 客户端；response 是响应对象；payload 是解析后的业务数据。状态码在 response.status_code，业务字段在 payload 中。不要把 response 与数字比较，也不要对 MCP 工具结果套用 HTTPX 方法。

HTTPX 用 `json=payload` 发送 JSON；`params={...}` 发送查询参数；`headers={...}` 发送请求头。data 通常用于表单等其他正文形态，不要与 json 随意互换。

## 10. pytest 怎样发现和运行测试

### 10.1 命名和执行过程

默认常用测试文件名是 `test_*.py` 或 `*_test.py`，测试函数名以 `test_` 开头。同一模块里重复定义同名函数，后面的定义会覆盖前面的名称，pytest 可能只发现后一个。

运行过程可以分成：收集模块与用例 → fixture 准备 → 测试函数 → fixture 清理。导入失败属于收集问题；服务启动失败属于准备问题；实际值不符通常是断言失败；进程关不掉可能是清理问题。

```powershell
# 只检查收集，不验证业务
.\tests\python\.venv\Scripts\python.exe -m pytest tests/python/test_health.py --collect-only -q

# 运行一个文件
.\tests\python\.venv\Scripts\python.exe -m pytest tests/python/test_health.py -v

# 运行指定文件中实际存在的函数，名称按你当前代码填写
.\tests\python\.venv\Scripts\python.exe -m pytest tests/python/test_health.py::test_health -v
```

`--collect-only` 仍会导入测试模块，所以顶层代码可能执行；它不运行测试函数和普通的测试 fixture 准备，不能算业务通过。未发现测试也不等于通过。

### 10.2 结果状态

| 状态 | 含义 |
| --- | --- |
| PASSED | 当前执行的断言成立 |
| FAILED | 测试函数中的检查失败或执行异常 |
| ERROR | 常见于收集、fixture 准备或清理错误 |
| SKIPPED | 按明确条件跳过，未验证通过 |
| XFAIL / XPASS | 已声明预期失败的案例实际失败/意外通过，进阶时再用 |

不要为了显示全绿，把依赖不足或难写的场景无条件 skip，也不要 catch 所有异常后继续返回成功。

## 11. fixture：准备数据与管理生命周期

### 11.1 最简单的 return fixture

```python
import pytest

@pytest.fixture
def sample_chapter():
    return {"id": "demo", "body": "原正文", "revision": 1}

def test_sample_has_body(sample_chapter):
    assert sample_chapter["body"] == "原正文"
```

pytest 看到测试参数名 sample_chapter，找到同名 fixture，运行后把返回值传给测试。fixture 的发现按名称，不是按参数类型。不要在测试里直接调用 `sample_chapter()`。

### 11.2 fixture 可以依赖 fixture

项目中的依赖关系类似：api_service 启动独立服务，base_url 接收其 URL，client 使用 base_url，story_project 使用 client 创建数据。pytest 根据参数依赖先准备上游资源；测试无需手动安排调用顺序。

conftest.py 用于共享 fixture。测试能看到当前目录和父目录的 conftest，不会自动读取兄弟目录中的 fixture。不建议通过导入另一个 conftest 来复用；共享资源放共同父目录，普通 helper 放普通模块。

### 11.3 return 和 yield

return 提供一个结果并结束函数；含 yield 的函数是生成器。pytest 对生成器 fixture 有特定处理：执行到 yield，交出资源；测试结束后继续执行后面的清理。

```python
@pytest.fixture
def opened_file(tmp_path):
    path = tmp_path / "sample.txt"
    file = path.open("w", encoding="utf-8")
    try:
        yield file
    finally:
        file.close()
```

tmp_path 是 pytest 提供的临时目录 Path 对象；`/` 在 Path 上表示组合路径。try/finally 保证离开时关闭文件，即使测试断言失败。实际业务还要考虑 yield 之前的准备中途失败，因此资源取得后就应安排好对应清理。

### 11.4 scope 和数据独立

默认 function 作用域每个测试准备一次；session 作用域在本轮 pytest 中共用一次，适合服务进程。共享服务不代表共享业务状态，每条用例仍应创建独立项目和章节。

session fixture 不能依赖生命周期更短的 function fixture，pytest 会报告 ScopeMismatch。先画出资源依赖图，再选择作用域；当前不用 autouse 自动启动所有资源，显式声明依赖更容易理解。

## 12. 参数化：同一种行为测试多组输入

```python
@pytest.mark.parametrize(
    ("source", "expected"),
    [
        pytest.param("  标题  ", "标题", id="outer-spaces"),
        pytest.param("标题", "标题", id="no-spaces"),
        pytest.param("   ", "", id="only-spaces"),
    ],
)
def test_strip_cases(source, expected):
    assert source.strip() == expected
```

装饰器里的两个名称对应函数的两个参数；列表每项是一组案例。pytest 会生成三个独立运行项，失败报告用 id 标识哪组失败。参数有三列时，每个案例都要提供三项，顺序也要一致。

Python 参数可以是不同类型，比如字符串、数字和 None；但被测操作要定义这些输入如何处理。`.strip()` 不适用于 None，不能只加 None 就期望它返回空字符串。如果要测试错误类型，先说明期望异常或接口错误，再选对应断言。

参数化适合相同流程、输入不同的案例。提案拒绝、成功接受、过期接受有不同准备和状态关系，保持独立测试往往更清晰。

装饰器中的可变字典不会自动为每个案例深拷贝。若测试修改案例字典，可能污染后续使用。创建请求体时用新字典、fixture 或工厂函数，避免多用例修改同一对象。

## 13. 资源、异常与上下文管理

### 13.1 with 为什么常见

```python
with httpx.Client(base_url=service_url, timeout=5.0) as client:
    response = client.get("/api/v1/health")
```

with 使用上下文管理协议进入和退出资源；代码块结束会关闭客户端，包括块内抛异常的情况。它比到处记住手动 close 更稳妥，但仍应了解清理顺序：客户端发完最后请求后再关闭，服务进程应在下游客户端结束后停止。

### 13.2 什么时候用 try/except

try 放可能失败的代码；except 处理明确可预期的异常；finally 无论是否异常都会执行，适合清理。

健康检查启动轮询中，连接暂时失败可以捕获 httpx.RequestError 后继续等待；测试正式操作时，连接失败通常应让测试报告错误，而不是吞掉。`except Exception: pass` 会隐藏程序错误、断言失败和连接故障，不适合让测试“稳定”。

如果明确验证一个函数应抛异常，可使用 pytest.raises：

```python
def test_int_rejects_invalid_text():
    with pytest.raises(ValueError):
        int("不是数字")
```

这个例子只有在抛出指定异常时才通过。HTTP 400/409 通常是正常返回的 Response，不会天然等于 Python 异常；HTTPX 的 raise_for_status 会主动把错误状态转换成异常。检查错误正文时先保留原始响应。

### 13.3 环境变量与子进程的基础认识

`os.environ` 表示当前 Python 进程环境变量。`os.environ["NAME"]` 缺少时抛 KeyError；`.get("NAME")` 返回 None。配置缺失时应明确解释缺了什么，不要用一个猜测默认地址掩盖问题。

`child_env = os.environ.copy()` 创建副本；覆盖测试目录、端口、专用 token 后交给 subprocess.Popen 的 env。子进程不会自动知道你定义的 Python 变量。改 child_env 不会自动改系统配置，也不会改已经启动的子进程。

进程生命周期、动态端口和健康等待属于下一步工程练习。理解“准备→等待就绪→使用→清理”后，再回到已有 api_service fixture 逐行阅读。

## 14. 怎样读一次失败

### 14.1 固定的排查顺序

1. 确认是这次保存的文件和最新运行结果。
2. 判断收集、准备、测试、清理中的哪个阶段失败。
3. 在 traceback 中找自己代码的相关行，读最后的异常类型和说明。
4. 看实际值和预期值，再检查必要响应与输入。
5. 修正根因，先重跑同一个用例，再做相关回归。

### 14.2 常见错误对照

| 现象 | 通常意味着什么 | 首先检查 |
| --- | --- | --- |
| SyntaxError / IndentationError | 文件无法解释 | 引号、括号、冒号和缩进 |
| ModuleNotFoundError | 当前解释器无法导入模块 | 虚拟环境、依赖和包路径 |
| fixture not found | pytest 未发现所声明资源 | 参数名、conftest 目录和插件 |
| KeyError | 字典缺少键 | 状态码、响应结构、配置是否存在 |
| TypeError: NoneType... | 把 None 当成字典/对象操作 | 上一步查找或函数返回是否成功 |
| assert 401 == 200 | 已收到响应但认证不符 | 请求头、测试 token 和服务配置 |
| assert pending == panding | 字符串预期可能拼错 | 契约中的真实枚举值 |
| 409 而非 200 | 当前状态与操作前提不兼容 | 版本、提案已处理状态、错误码 |
| ConnectionError / timeout | 没拿到预期响应 | 服务就绪、地址端口、代理、超时 |

不要把所有 timeout 都解释成“等得不够久”。若 URL 错误、按钮被禁用或请求根本未发出，延长等待不会修复它。

## 15. 看懂一条接口测试的完整数据流

以下是阅读已有项目代码时的顺序，不是完整测试答案：

```text
fixture 启动独立 Service
→ client 连接这次实际 URL
→ 用本次凭据创建项目，取 project_id
→ 在项目下创建章节，取 chapter_id 与 revision
→ 执行当前测试目标操作
→ 检查响应
→ 重新 GET 文档列表
→ 按 chapter_id 找到目标
→ 比较标题、正文和版本
→ fixture 清理客户端和进程
```

要能说出每个值的来源：project_id 不是任意字符串，chapter_id 不是列表第一项，revision 来自真实目标响应。POST 创建后的响应、PUT 保存后的响应、GET 读回的结果是三个时刻的数据，变量名最好体现这些时刻。

前端重构后新增了项目总览，但管理员 Story 文档请求仍有自己的路径。界面入口变化不代表所有 API URL 也要机械替换。浏览器操作与直接接口调用连接的是不同入口，详见完整指南的 Service/Portal 区分。

## 16. 后续会遇到的进阶概念：先建立认识

### 16.1 同步与异步

同步 `client.get()` 直接等待并得到响应。异步函数用 async def 声明，调用后得到协程对象，需要由异步运行器执行，通常在 async 函数中 await 获取结果。

```python
async def fetch_health(async_client):
    response = await async_client.get("/api/v1/health")
    return response
```

await 不是“自动另开线程”，也不能把同步 HTTPX 调用直接变异步。进入 MCP 阶段才需要系统学习 async with、AnyIO 和连接生命周期，基础阶段先把同步写法弄懂。

### 16.2 Mock 和真实依赖

Mock 用可控制替代物代替某项依赖。例如浏览器拦截一次保存请求并返回 503，帮助稳定验证错误提示。它证明页面如何处理这个模拟响应；真实服务是否在某种故障下返回 503，要另做集成测试。

只替代当前用例需要控制的边界。若连被测保存行为本身都替换掉，再断言替代物返回成功，就无法证明真实保存能力。

### 16.3 重试和等待

等待是在当前操作后观察条件是否成立，例如等保存结果；重试是再次执行某个操作。重复 GET 通常用于观察状态，重复 POST/PUT 可能产生新的数据或版本，不能因为超时就无条件再写一次。

## 17. 分批练习与完成标准

小练习建议独立放在未来的 `tests/learning/python/test_foundations.py`，与已有真实业务测试分开。该文件目前由你按需创建。不要把故意失败的版本留进正式回归；本教材没有自动添加任何练习脚本。

### 练习一：设计与断言

为“拒绝提案不改变正式正文”写准备、操作、响应预期、数据预期和判断依据。然后对固定字典写正文/版本断言，临时改错一个预期，观察失败后恢复。

完成标准：能说明为何检查 rejected 还不足以证明正文没变；能区别赋值与比较。

### 练习二：集合与查找

自己构造三个不同 ID 的章节字典列表，用 for 循环找到中间目标；再换一个不存在的 ID。掌握后改成 next 写法，对比找到和没找到时的结果。

完成标准：不依赖列表排序；访问字段前检查目标存在；能解释 next 的默认值。

### 练习三：函数与参数化

写一个只清理标题首尾空白的普通函数，测试正常标题、首尾空白和全空白。先写三条独立测试，再改成参数化。暂时不要自行加入 None，除非先定义函数对 None 的规则。

完成标准：三组实际运行，失败报告能看到案例名；能解释函数参数、返回值和参数化映射。

### 练习四：fixture

写一个返回新章节字典的 function fixture，两条测试都使用它。让第一条在本地修改正文，第二条仍应拿到原始正文。然后解释把共享字典放在模块顶层可能带来的差别。

完成标准：fixture 按名称注入；不手动调用 fixture；两条测试顺序无关。

### 练习五：回读已有接口测试

打开你现有健康检查和提案测试，标出 fixture、请求、状态检查、JSON 解析、目标查找和数据读回。挑一条现有断言，用一句话说明它能证明什么、还不能证明什么。

完成标准：能定位自己代码里的一个缺口，先解释再修改；运行结果与代码版本对应。

你完成后提交当前代码和最新运行输出即可。助手按证据更新掌握情况；阅读、复制或得到参考答案后跑通，都先作为学习经历记录。基础练习完成，再回到项目 A 收尾与 B0 新入口，不需要先学习完整异步框架。
