---
name: enterprise-ai-ontology
title-zh: 企业 AI 落地知识底座
title-en: Enterprise AI knowledge base
description: 企业 AI 落地的顾问级知识底座：新四层架构（记录系统、Ontology 业务本体、LLM、Agent）、Ontology 的微观构造（Object、Link、State、Events、Logic、Action、Write-back）和“三大脑”金句模型。选题涉及企业 AI 落地、Palantir、Ontology、本体、大模型、Agent 时使用。
keywords: Palantir, Ontology, 本体, Agent, 智能体, 大模型, LLM, 企业AI, AI落地, AI转型, ERP, MES, Foundry, AIP, FDE, Agentic, 知识图谱, 数字孪生
steps: plan, write, review, script
---

# 企业 AI 落地知识底座

这是创作者自己的专家框架，可以当作事实来源直接使用。

口播里的叫法：Ontology 保留英文原名，第一次出现时说明“中文叫本体”；LLM 说成“大模型”；Agent 说成“智能体”。其余英文组件名（Object、Link、State、Events、Action、Write-back）放在画面和板书上，口播说括号里的人话，需要时再带一次英文名。

## 一、企业 AI 落地“新四层架构”

1. 第一层，记录系统（System of Record）：ERP、CRM、MES（生产执行）、财务系统、HR 系统。里面是分散的静态数据和互不相通的表单。
2. 第二层，核心中枢 Ontology（业务本体）：打通底层孤岛，把业务语义、状态机、判断规则和跨系统回写动作封装在一起。它是上下两层之间唯一的桥。
3. 第三层，认知推理 LLM（大语言模型）：负责理解、分析权衡和多步规划。红线：不允许绕过 Ontology 直接连底层的 ERP、MES、财务库。
4. 第四层，自主执行 AI Agent 与 Agentic Workflow：感知事件触发，编排多步工作流，调用 Ontology 里的动作完成闭环。

讲这四层时从下往上讲，重点落在第二层：没有它，上面两层要么看不懂业务，要么不敢动手。

## 二、Ontology 的微观构造（Data → Logic → Action）

- 名词与关系（Data）：Object Type（业务对象类型，比如订单、设备、客户）加 Link（对象之间跨系统的关联）。
- 对象内部的脉搏（让静态数据变活）：
  - Properties（属性）：对象有哪些特征。
  - State（生命周期状态机）：对象现在处于哪个阶段。AI 读懂当前状态，才知道下一步能做什么。
  - Events（事件流）：发生了什么。事件是唤醒 AI 介入的扳机。
- 逻辑与行动（Logic 和 Action）：
  - Logic：专家规则、风控红线、算法模型。
  - Action Type：标准化的可执行动作。
  - Write-back：把结果回写到底层的 ERP、CRM、MES、财务系统，并更新对象的 State。
  - Agentic Workflow：把多个动作编排成多步的智能体工作流。

一句话范式：先把数据映射成业务对象，再给对象装上规则，最后让动作能回写进系统。

## 三、“三大脑”协同模型（核心认知金句）

- Ontology 是企业的业务大脑：掌管全景记忆、实时状态、业务规则和动作护栏。
- LLM 是企业的推理大脑：读取 Ontology 给的上下文之后，负责理解、权衡和多步规划。
- Agent 与 Agentic Workflow 是企业的执行手脚：接收推理大脑的指令，调用业务大脑里受控的 Action，完成跨系统执行。

金句的口播说法：Ontology 是业务大脑，大模型是推理大脑，智能体是执行手脚。

## 四、Palantir 的背景（讲演进时用）

- Palantir 的平台以 Ontology 为核心：把客户的业务对象、规则和动作建成一个可操作的模型，而不只是一张数据表。
- 它的交付方式是派前线部署工程师（FDE，Forward Deployed Engineer）驻场，和业务一起把 Ontology 建出来。
- 它的 AI 平台 AIP 把大模型接在 Ontology 之上：模型通过 Ontology 读业务、调动作，而不是直接碰底层数据库。

收入、利润、市值、增速这类财务数字不在这份底座里：只用需求和参考资料中给出的数字，没有就定性地说，并列入待核实。

## 五、常见误区（顾问视角，可作为经验段的方向）

- 让大模型直接连 ERP、MES：模型看到的是字段名，不是业务，结果不是答非所问就是不敢让它执行。
- 把 Ontology 当成又一个数据仓库或知识图谱：仓库只存，图谱只查，Ontology 还管状态、规则和回写。
- 一上来就给全公司建模：应该从一个高价值、跨系统、有明确动作的场景切入。

这些是方向，不是数据。讲成经验时不要附带编造的比例和客户名。
