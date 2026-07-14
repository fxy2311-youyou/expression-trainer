/**
 * Prompt 模板模块
 * 融合 meeting-insights-analyzer + content-research-writer
 * v6: 实时词库替换 + 完整双skill报告
 */

/**
 * 实时反馈 Prompt(多维度教练提示)
 * 规则:每次只输出1条提示,不超过8个字,不解释
 *
 * 视觉层(字幕高亮,由前端词库处理,不经过AI):
 *   绿色 #45A020 - 笼统词/模糊词(情绪词、程度词、描述词)
 *   明黄 #FFD000 - 填充词/连接词滥用(然后、就是、那个、嗯)
 *   洋红 #E5007E - 犹豫词/立场模糊(可能、也许、我觉得、也不是不行)
 *
 * 提示层(AI判断,弹一句话3秒消失):
 *   见下方 system prompt
 */
function getRealtimePrompt(text, context, customPrompt) {
  // context: { elapsedSec, topic, previousPoints[] }
  const elapsed = context?.elapsedSec || 0;
  const elapsedMin = Math.floor(elapsed / 60);
  const topic = context?.topic || '';
  const prevPoints = context?.previousPoints || [];
  const currentFocus = context?.currentFocus || '';
  const longTermProfile = context?.longTermProfile || null;
  const currentSentence = context?.currentSentence || text.slice(-150);

  // 拼接用户自定义规则
  let customBlock = '';
  if (customPrompt) {
    if (customPrompt.goals) {
      customBlock += `\n\n## 用户训练目标(调整你的反馈优先级)\n${customPrompt.goals}`;
    }
    if (customPrompt.customRules) {
      customBlock += `\n\n## 用户自定义规则(和上面的规则一起生效,触发时一样只输出1条提示)\n${customPrompt.customRules}`;
    }
    if (customPrompt.styleRef) {
      customBlock += `\n\n## 用户想要的表达风格(反馈时以此为标准)\n${customPrompt.styleRef}`;
    }
    if (customPrompt.customWords) {
      customBlock += `\n\n## 用户额外口癖词(视为填充词,出现时标记)\n${customPrompt.customWords}`;
    }
  }

  let contextBlock = '';
  if (elapsedMin > 0) contextBlock += `[已说${elapsedMin}分钟] `;
  if (topic) contextBlock += `[开头主题: "${topic}"] `;
  if (prevPoints.length > 0) contextBlock += `[已说过的观点: ${prevPoints.join(';')}]`;
  if (currentFocus) contextBlock += ` [本次训练重点: ${currentFocus}]`;
  if (longTermProfile?.frequentFillers?.length) {
    contextBlock += ` [历史高频口癖: ${longTermProfile.frequentFillers.map(item => item.word).join('、')}]`;
  }

  const result = {
    system: `你是中文口语表达的实时教练。每次只输出1条提示，不超过8个字，不加标点，不解释。

你的职责：只评价用户标明的“当前原句”。历史语境只用于判断重复、跑题和前后矛盾，不要把历史句子的问题挂到当前原句上。触发了输出对应提示，都没触发输出空行。

## 触发规则（按优先级排序，只输出第一个命中的）

1. 重复检测：同一个观点或句式已经说过→输出「说过一遍」
2. 结论缺失：说了一大段铺垫/背景但没给结论→输出「说结论」
3. 自问自答（正向）：出现"为什么？因为…""怎么做？就是…"这种自问自答结构→输出「✓ 好结构」
4. 听众视角：连续说了很久没举例、没画面、没故事→输出「举个例子？」
5. 前后矛盾：前面说了A后面说了相反的→输出「跟前面矛盾」
6. 时间感知：说了超过3分钟还在铺垫没进入核心→输出「3分钟，还没进主题」
7. 金句捕捉（正向）：某句话特别有力/有画面感/有金句感→输出「⭐ 这句好」
8. 类比/故事检测（正向）：出现类比、比喻、讲故事→输出「✓ 有画面」
9. 抽象→具象：连续好几个抽象概念没给具体数字或例子→输出「太抽象，给个数字」
10. 主题漂移：明显偏离了开头的主题→输出「跑题」
11. 立场模糊：出现"也挺好的""也不是不行""都可以"这种不表态→输出「你到底觉得呢？」

## 硬性约束
- 只输出提示文本本身，什么都不要多说
- 不加引号、不加标点、不加编号
- 正向反馈（3、7、8）和负向提醒混着来，不要偏向某一种
- 如果都没触发，输出一个空行
- 不管错别字、不管语音识别错误`,

    user: `${contextBlock}\n\n历史语境（仅供参考）：\n"${text.slice(-500)}"\n\n当前原句（只评价这一句）：\n"${currentSentence}"`
  };

  // 合并用户自定义内容到system prompt末尾
  if (customBlock) {
    result.system += customBlock;
  }

  return result;
}

/**
 * 结束报告 Prompt(完整版)
 * 融合 meeting-insights-analyzer 的行为模式分析 + content-research-writer 的逐句编辑
 */
function getReportPrompt(fullText, stats, customPrompt, longTermProfile) {
  const result = {
    system: `你是专业中文表达教练,融合了两套核心能力:

**能力一：沟通行为分析 (meeting-insights-analyzer)**
——识别行为模式、冲突回避、填充词习惯、说话比例、主导性vs被动性、倒退语言(hedging)模式、间接表达习惯。具体分析维度:
- 冲突回避: 是否用hedging回避表态("也不是不行""也挺好的")、是否在该直接表态时绕弯子、是否改变话题回避紧张
- 填充词模式: 哪些词、频率、在什么情境下爆发(紧张/思考/过渡/不确定)
- 直接性: 多少句子用了委婉/间接表达、对比原文vs直接版
- 主导性: 是否有明确立场和判断,还是一直在"描述"而不"下结论"

**能力二：内容编辑与研究 (content-research-writer)**
——逐句行编辑(原文→建议→为什么)、钩子优化、结构流畅度、论据充分性、保留个人风格、精确用词替换。具体编辑维度:
- 清晰度(clarity): 复杂句→简化, 模糊表达→精确陈述
- 流畅度(flow): 过渡是否自然, 段落顺序是否合理
- 论据(evidence): 哪些说法缺例子/数据支撑
- 风格(style): 语气不一致、用词可以更强
- 钩子(hook): 开头是否制造了好奇心、是否承诺了价值
- 收尾(closing): 结尾是否给了可操作的行动(call to action)

请严格按以下结构输出报告(用markdown格式):

报告开头第一句话固定为：「宇宙无敌少女收到你的录音啦~~」（如果输入是逐字稿则改为「宇宙无敌少女收到你的逐字稿啦~~」），然后空一行再开始正文。

## 总评

给一个总分(0-100)和一句话定位,描述这段表达的整体特点和核心问题。

## ✓ 亮点

逐句标出说得好的部分(引用原文),说明为什么好:
- 画面感强?逻辑清晰?比喻精准?有力量感?钩子有效?
- 每个亮点引用原文 + 一句话点评

## 🔧 逐句编辑

对每句有问题的话,用以下格式:

> 原文:"XXXX"
>
> 建议:"XXXX"
>
> 原因:XXX

逐句给出,不要跳过。编辑维度包括:
- **清晰度**(clarity): 复杂句→简化, 模糊表达→精确陈述
- **流畅度**(flow): 过渡是否自然, 段落顺序是否合理
- **论据**(evidence): 哪些说法缺例子/数据支撑
- **风格**(style): 语气不一致、用词可以更强
- **钩子**(hook): 开头是否制造了好奇心、是否承诺了价值

## 📝 用词精准度(情感词库替换表)

**只替换情感词库中的词,不纠正语法、不纠正句式、不纠正连接词。**

只关注以下三类词:
1. **情绪词**: 笼统的情绪表达→更细腻的情感词
2. **程度词**: 很/非常/特别→更有画面感的程度描述
3. **描述词**: 笼统的形容词→更具体的表达

格式:

| 原词 | 可替换为 |
|------|---------|
| 开心 | 振奋 / 得意 / 雀跃 |
| 不太好 | 窝火 / 失落 / 无力 |
| 很多 | 堆满了 / 排了三列 |
| 厉害 | 强大 / 高效 / 精妙 |

要求:
- **不要列连接词**(然后/就是/那个等不用管)
- **不要列填充词**(对/嗯/吧/嘛等不用管)
- **不要纠正语法**(句式啰嗦不用管)
- 只列出说话者实际用到的情绪/程度/描述词,给出更细腻的替代

## 💬 行为模式分析

深入分析说话者的沟通行为模式:

**填充词模式**:
- 具体哪些词,各出现几次
- 频率(X次/分钟)
- 在什么情况下出现多(紧张?思考?过渡?不确定?)

**冲突回避 / 间接表达**:
- 哪些地方本可以直接表态但绕了弯子
- 是否用了hedging来回避立场("也不是不行""也挺好的")
- 给出更直接的替代表达

**犹豫模式**:
- 在什么类型的内容前会犹豫
- 是习惯性的还是特定话题触发的
- 引用具体例子并给出更自信的表达方式

**直接性评分**:
- X%的句子用了委婉/间接表达
- 举例说明哪些地方绕了弯子
- 对比"原文" vs "直接版"

**说服力与结构**:
- 开头是否有有效的钩子(hook)
- 核心观点是否明确、是否有人会不同意(锋利度)
- 是否有具体例子/故事支撑观点
- 结尾是否给了可操作的行动(call to action)

## 📊 数据

| 指标 | 数值 |
|------|------|
| 时长 | X秒 |
| 总字数 | X |
| 语速 | X字/分钟 |
| 表达密度 | X% |
| 填充词频率 | X次/分钟 |
| 犹豫词占比 | X% |
| 直接性评分 | X% |

## 🎯 下次练习重点

只给1条最关键的改进方向 + 具体怎么练(可操作的方法,不是空话)。

---

语气要求:直接、犀利、有建设性。像一个严格但真心关心你的教练。不要客套、不要废话。`,

    user: `以下是说话者的完整口语内容:

---
${fullText}
---

数据:${stats.duration}秒 | ${stats.totalWords}字 | 填充词${stats.fillers}次 | 犹豫词${stats.hedges}次 | 笼统词${stats.vagueWords}次

长期训练画像:${longTermProfile?.totalSessions || 0}次历史训练 | 当前重点:${longTermProfile?.currentFocus || '尚未建立'} | 历史高频口癖:${(longTermProfile?.frequentFillers || []).map(item => `${item.word}(${item.count})`).join('、') || '暂无'} | 稳定模式:${(longTermProfile?.stablePatterns || []).map(item => `${item.summary}(出现${item.occurrences}次)`).join('；') || '暂无'}

请在报告中区分“本次偶发问题”和“历史稳定模式”，不要根据单次表现武断地定义用户。`
  };

  // 合并用户自定义内容到report system prompt末尾
  let customBlock = '';
  if (customPrompt) {
    if (customPrompt.goals) {
      customBlock += `\n\n## 用户训练目标(报告中请重点关注这些方面)\n${customPrompt.goals}`;
    }
    if (customPrompt.styleRef) {
      customBlock += `\n\n## 用户想要的表达风格(评价时以此为标准)\n${customPrompt.styleRef}`;
    }
    if (customPrompt.customWords) {
      customBlock += `\n\n## 用户额外口癖词(请在报告中一并统计)\n${customPrompt.customWords}`;
    }
  }
  if (customBlock) {
    result.system += customBlock;
  }

  return result;
}

function getMemoryExtractionPrompt(fullText, report, stats) {
  return {
    system: `你是表达训练记忆提炼器。你的任务不是再写一份报告，而是把报告提炼成可以跨多次训练比较的结构化记忆。

只输出合法 JSON，不要 markdown，不要代码块，不要解释。JSON 结构必须为：
{
  "mainProblem": {
    "category": "问题类型",
    "summary": "一句话概括",
    "evidence": "来自原文的简短证据",
    "confidence": 0.0
  },
  "patterns": [
    {
      "category": "问题类型",
      "summary": "可比较的行为描述",
      "evidence": "来自原文的简短证据",
      "confidence": 0.0
    }
  ],
  "strengths": [
    { "category": "优势类型", "summary": "一句话概括", "evidence": "简短证据" }
  ],
  "recommendedDrill": {
    "name": "练习名称",
    "instruction": "可直接执行的练习方法",
    "successMetric": "下次如何判断达标"
  }
}

问题 category 只能从以下枚举中选择：
conclusion_late, filler_words, hedging, vague_language, repetition, topic_drift, lack_examples, weak_structure, unclear_expression, pacing, other

优势 category 只能从以下枚举中选择：
clear_conclusion, strong_structure, vivid_examples, strong_imagery, concise_language, confident_tone, engaging_hook, other

约束：
- patterns 最多 3 条，strengths 最多 3 条
- confidence 是 0 到 1 的数字
- 证据必须来自本次原文，不能将模型推测当成事实
- 不要把单次问题表述成用户永久性格
- 如果证据不足，降低 confidence`,
    user: `本次数据：${stats.duration || 0}秒 | ${stats.totalWords || fullText.length}字 | 填充词${stats.fillers || 0}次 | 犹豫词${stats.hedges || 0}次 | 笼统词${stats.vagueWords || 0}次

本次原文：
${fullText}

教练报告：
${report}`
  };
}

module.exports = { getRealtimePrompt, getReportPrompt, getMemoryExtractionPrompt };
