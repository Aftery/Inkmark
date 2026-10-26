# Markdown 标准语法示例

这是一个完整的 Markdown 文件示例，包含标题、列表、代码高亮、数学公式、表格、引用等常见语法。

---

## 1. 标题

# 一级标题（H1）
## 二级标题（H2）
### 三级标题（H3）
#### 四级标题（H4）
##### 五级标题（H5）
###### 六级标题（H6）

---

## 2. 文本样式

普通文本。

**粗体文本**

*斜体文本*

***粗斜体文本***

~~删除线文本~~

`行内代码`

下标：H~2~O（GFM 扩展）

上标：X^2^（GFM 扩展）

键盘按键：<kbd>Ctrl</kbd> + <kbd>C</kbd>

---

## 3. 列表

### 无序列表

- 第一项
- 第二项
  - 嵌套项 2.1
  - 嵌套项 2.2
- 第三项

### 有序列表

1. 第一项
2. 第二项
   1. 嵌套项 2.1
3. 第三项

### 任务列表（GFM 扩展）

- [x] 已完成的任务
- [ ] 未完成的任务
- [ ] 待办事项 3

---

## 4. 代码高亮

### Python 示例

```python
import numpy as np


def fibonacci(n: int) -> list[int]:
    """计算斐波那契数列的前 n 项。"""
    seq = [0, 1]
    for i in range(2, n):
        seq.append(seq[-1] + seq[-2])
    return seq[:n]


if __name__ == "__main__":
    result = fibonacci(10)
    print(f"斐波那契数列: {result}")
    print(f"均值: {np.mean(result):.2f}")
```

### JavaScript 示例

```javascript
const greeting = (name) => {
  console.log(`Hello, ${name}!`);
};

class Calculator {
  #value = 0;

  add(n) {
    this.#value += n;
    return this;
  }

  get result() {
    return this.#value;
  }
}

new Calculator().add(3).add(4).result; // 7
```

### C 示例

```c
#include <stdio.h>

int main(void) {
    for (int i = 0; i < 5; i++) {
        printf("Hello, Markdown! %d\n", i);
    }
    return 0;
}
```

### Go 示例

```go
package main

import "fmt"

func main() {
	for i := 1; i <= 5; i++ {
		if i%2 == 0 {
			fmt.Printf("%d 是偶数\n", i)
		}
	}
}
```

### SQL 示例

```sql
SELECT id, name, age
FROM users
WHERE age > 18
ORDER BY age DESC
LIMIT 10;
```

### 无语言标注的代码块

```
这是一段普通代码块，无语法高亮。
```

---

## 5. 数学公式

### 行内公式

质能方程 $E = mc^2$，勾股定理 $a^2 + b^2 = c^2$，集合 $\emptyset \in \mathbb{R}$。

### 块级公式

高斯积分：

$$
\int_{-\infty}^{\infty} e^{-x^2} \, dx = \sqrt{\pi}
$$

欧拉公式：

$$
e^{i\theta} = \cos\theta + i\sin\theta
$$

二次方程求根公式：

$$
x = \frac{-b \pm \sqrt{b^2 - 4ac}}{2a}
$$

求和与极限：

$$
\sum_{i=1}^{n} i = \frac{n(n+1)}{2}, \qquad \lim_{x \to 0} \frac{\sin x}{x} = 1
$$

矩阵：

$$
A = \begin{pmatrix}
a_{11} & a_{12} & a_{13} \\
a_{21} & a_{22} & a_{23} \\
a_{31} & a_{32} & a_{33}
\end{pmatrix}^{-1}
$$

分段函数：

$$
f(x) = \begin{cases}
x^2, & x \geq 0 \\
-x, & x < 0
\end{cases}
$$

多行对齐公式：

$$
\begin{aligned}
(a+b)^2 &= a^2 + 2ab + b^2 \\
(a-b)^2 &= a^2 - 2ab + b^2
\end{aligned}
$$

> 提示：行内公式用单个 `$...$` 包裹，块级公式用 `$$...$$` 包裹。部分渲染器（如极见的 KaTeX / MathJax）需要插件或配置支持。

---

## 6. 表格

| 姓名 | 年龄 | 邮箱             |
| :--- | ---: | :--------------: |
| 张三 | 25   | zhang@ex.com     |
| 李四 | 30   | lisi@example.com |
| 王五 | 28   | wu@ex.io         |

左对齐用 `:---`，右对齐用 `---:`，居中用 `:---:`。

---

## 7. 引用

> 这是一级引用。
>
> > 这是二级嵌套引用。
> >
> > 回到二级。

---

## 8. 分隔线

---

---

## 9. 链接与图片

- [百度](https://www.baidu.com)
- 带标题的链接：[GitHub](https://github.com "GitHub 主页")
- 自动链接：<https://www.example.com>
- 引用式链接：

  这是一个 [示例链接][1]。

[1]: https://www.example.com

图片：

![Markdown Logo](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAANwAAACWCAMAAACCRxa5AAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAABLUExURQ8XKhYyTBxNbSZznCZ0nTi9+DCbziuHtRUkOS82SNzi63J5h5CWo8jO2FVcbNXc5DNJX6euuXyDkFxjcuLo8LS7xVFZaCMrPb3DzbG7OQQAAAAHdElNRQfqChoFIByJUYcYAAAAJXRFWHRkYXRlOmNyZWF0ZQAyMDI2LTEwLTI2VDA1OjMyOjI4KzAwOjAwbVWyIgAAACV0RVh0ZGF0ZTptb2RpZnkAMjAyNi0xMC0yNlQwNTozMjoyOCswMDowMBwICp4AAAAodEVYdGRhdGU6dGltZXN0YW1wADIwMjYtMTAtMjZUMDU6MzI6MjgrMDA6MDBLHStBAAAGN0lEQVR42u2diW6kMAyGDQFyECZkEo73f9KV7XB02mp3Omq7Qfk1Kinh8Gc7DlOpBGBXVYsme4m6gneqmvYyah74BO7s5G/7/XXJDknECU11bdvVcBHVSKN2trZtL4NGeG3bbnRd21YvXu4/U9W2HbfE5diITqTtpXKSVXPEmi2C11LXNgBwycBR6Cgrf9uO7xHmZX3NrMS8rEG08rfN+B7JVkBDA++CQrACl6MKXK4qcLmqwOWqAperClyuKnC5qsDlqgKXqwpcripwuarA5aoCl6sKXK4qcLmqwOWqAperClyuKnC5qsDlqgKXqwpcripwuerf4LTp97YdPjtquD3sUG78gkn+/rNwIU5H03/mgagf9sxx+YJJJvwsnI2bmdrFzxwbzOOefoDnNb7z0TfDTX5z5+Ti/JkHpsc93sPzeu+jb4YzfbKzN3eOYZicmcaAPL2fJ2MUTBYj680CoK0zwx0GGqmzd4ZbjvyiHQ/gtcfxdfR+4CPVr8b5NHDDhO3b+q7jNTgdx95hYzQ9N2y0IXgzIbIfXH8bAcwN3b5qgNmsfbg7T0Hu49QHa5CcqWy0HKEFwK2u13oeTqm+2uO+g7EhTIYgvDlu+abjRbgQlY4jgBomTrUQqTD6iNa6YWEP6MXTgFwc2TfGqABuMfAlNMB6p8o7TBuEjnwue4yDFY96MnEv8fRcefkO60od61/S/p/gsPoPFsAazd5n6+GGodEMCsEFN4xwmiwG3A422XwD8Ni2K9WZm9HpAnSh/V6nehIMN/F4nQZ9wDO2jvtfCtY/weFosivMMYDGi8/JACr1N8P/p2ZjtNRSe/Gxx6GAcNajlTOVDMq+zQ39UUROQfQpQRFuK7w3vN506ngZDq2d4+h84rH+dPGtAKzRbg5P/5XnwtFLkyD+Qk5aYCbnb+afiojdU02Z+di13g/2Jc6Px34djsebcW5JmbCNf7ItGaiMT6Pl4BkPJ1O0+gEDR6C8351inDTszXGbW9c7qDPPHJP33lTZL8JxKLj2UT1JtVzx+AubKZar1x5Xcxya6pDDwKGlnK37M83xUKLi/gwX4uakeT9SufsxE5L3XoWzPLWQH888d64nx6j3Th9wi5sOOE0pNkfeusDT5mblqYjM53qSbj8cHHeuJ2e7XoQ7JQ3VE67NEKjU73fyAIpqd48TGCwTjUFPOaq5+o/Rkz2rZ4QtgcOH9SSV4Z5uyU4KEU8cOUf7T5+VnoE7PcneKN1vNIW76VxPKP+XYVKwuDUE63gIjsaHYM2apkK2x6eH7+l9PfFDYI08bfcTzaVwN/YWvPPE7s1973gRTpvjSbZnMwI+/GhrT19QeLxpZNT4RBXSaaN3Zu23+slQNl1xSK73h5lrTLI0jx3PWD22NaezOne8GLn/SO6v0coPTjsO/ZNfh/KASyVErdNTp+UBB8MwLzoM5rnvsZnA6QmLjH/yO3omcAB6HNWz52QD9xUVuFxV4HJVgctVBS5XFbhc9Rpctb8lpq5BfvB2rU5KKRUIfElVJfAEKU83209Xb143UzWps5FSdvVD70/BHRIfvjesFvxD4rvhRM3OEPtr8Crx5sDjtDrBdfSivIfen4ITFXRCNDVaohqoG9FIxJCSfS1qNrxD86TCD4Ai0ymGNW1kVXeySU0yquLwccTkJ577bjgJCmMi8YOJWZPX0fGCna8Aqk5VDcagO6cXnqdahZuqpSvwHursUvgoYqKGr74i6VU4un+HCYZRZFu6PQTYaiq0U9RVQwcL2VVbTDvaKPIN7yGMFLAKREdD7nfgGAmNIfeSUU1V7Vfb6k1TgeqIEDYAimlDm1rQ4EN38ODioSjpINWdh+ZPwqWMwYqhtijKkz11ehEcRbSroG72eoLDSlKFVR0nMntg9wkO5I4PFF99n9xLcI0iOFGB3KJICdalcr8VAslFD6DppKxTUCl1cYO+6FI94b8kYEGq04yQwvvzcP+7ClyuKnC5qsDlqgKXqwpcripwuarA5aoCl6sKXK4qcLmqwOWqAperClyuKnC5qsDlqgKXqwpcrro83KUX+rr0Em2XXlzv0ssiXntBy0svRXrpRWSvvfzvtRduvvSS29deLP3iy9wTXy1+2++vS9Qnsj8iaWPZpm59QgAAAABJRU5ErkJggg==)

图片（HTML 语法，可控制大小）：

<img src="data:image/png;base64,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" width="200" alt="logo" />

---

## 10. 脚注

这里有一个脚注引用[^1]，还有一个长脚注[^long]。

[^1]: 这是脚注内容。
[^long]: 这是一个包含多个句子的长脚注，用于演示多行脚注内容。

---

## 11. 内嵌 HTML

<div align="center">
  <p>这是一个居中的 HTML 块</p>
  <p><b>Markdown 原生支持部分内嵌 HTML</b></p>
</div>

<details>
  <summary>点击展开详情（GFM 折叠块）</summary>

  这里是折叠的内容，可以包含 **Markdown 语法**。

  - 列表项 1
  - 列表项 2

</details>

---

## 12. 转义字符

显示特殊字符本身需要加反斜杠：

\*不是斜体\*
\# 不是标题
\` 不是代码

<!-- 这是 HTML 注释，渲染时不可见 -->
