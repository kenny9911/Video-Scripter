// 简体中文 for the web: the sources of a script or a reply, the two switches in the brief, and the Web search
// tab of LLM settings. The English text is the key (see i18n.js); web.js imports this file first, so the
// words are in place before anything is drawn.

import { addTranslations } from './i18n.js';

addTranslations({
  // LLM settings: the tabs and the Web search tab
  'Settings sections': '设置分区',
  'LLM gateways': '模型网关',
  'Web search': '联网搜索',
  'With a web service set up, the links in a brief, in its documents and in a chat prompt are read before anything is written, and a topic or a question can be searched for. One service is enough. Keys are stored on the server and are never sent back to the browser.':
    '配置联网服务后，需求、素材文档和对话提示里的链接会在动笔之前先被读取，还可以就主题或问题联网搜索。配置一个服务即可。密钥保存在服务器上，不会再发回浏览器。',
  'Tavily API key': 'Tavily API 密钥',
  'Tavily MCP link': 'Tavily MCP 链接',
  'Firecrawl API key': 'Firecrawl API 密钥',
  'The address of Tavily’s hosted MCP server, with your key in it. Either the key or the link is enough; with both, the key is used first and the link when it fails.':
    'Tavily 托管 MCP 服务的地址，其中带有你的密钥。密钥和链接填一个就够；两个都填时先用密钥，失败时再用链接。',
  'Search with': '搜索使用',
  'Read links with': '读取链接使用',
  'The other service, when it is set up, is asked when the first one fails.': '首选服务失败时，会改用另一个已配置的服务。',
  'Try it': '试一试',
  'A question to search for, or a link to read': '输入要搜索的问题，或要读取的链接',
  'Uses the values above, saved or not. A link is read; anything else is searched for.': '使用上面填写的值，保存与否都可以。填链接就读取网页，其他内容就搜索。',
  Service: '服务',
  'As set above': '按上面的设置',
  '{name} only': '只用 {name}',
  Test: '测试',
  'Asking the web…': '正在联网…',
  'No answer after {ms} ms': '{ms} 毫秒后仍无结果',
  '{service} read the page in {ms} ms · {n} characters': '{service} 用 {ms} 毫秒读完网页 · {n} 个字符',
  '{service} answered in {ms} ms · {n} results': '{service} 用 {ms} 毫秒返回 · {n} 条结果',
  'Save web settings': '保存联网设置',
  Remove: '移除',
  'Remove the saved {what}?': '移除已保存的 {what}？',
  'Removed.': '已移除。',
  Ready: '可用',
  'Not set up': '未配置',
  'Add a Tavily or a Firecrawl key first.': '请先添加 Tavily 或 Firecrawl 的密钥。',
  'Tavily is not set up: add its key first.': 'Tavily 尚未配置：请先添加密钥。',
  'Firecrawl is not set up: add its key first.': 'Firecrawl 尚未配置：请先添加密钥。',
  'The Tavily MCP link must be an http(s) address, such as https://mcp.tavily.com/mcp/?tavilyApiKey=…': 'Tavily MCP 链接必须是 http(s) 地址，例如 https://mcp.tavily.com/mcp/?tavilyApiKey=…',
  'An API key cannot contain spaces': 'API 密钥不能包含空格',

  // The brief
  Web: '联网',
  'read before writing': '动笔前先读',
  'Read the links in the brief and in my documents': '读取需求和素材文档里的链接',
  'Search the web about the topic': '就主题联网搜索',
  'Links are read when the writing starts, up to 8 for one brief. What was read is listed with the script.': '开始写作时读取链接，一份需求最多 8 个。读到的内容会列在脚本里。',
  'The web is not set up yet.': '联网功能尚未配置。',
  'An administrator can add a Tavily or Firecrawl key under LLM settings, Web search.': '管理员可以在“模型设置 → 联网搜索”中添加 Tavily 或 Firecrawl 的密钥。',

  // Progress
  'Reading 1 link…': '正在读取 1 个链接…',
  'Reading {n} links…': '正在读取 {n} 个链接…',
  'Reading 1 link and searching the web…': '正在读取 1 个链接并联网搜索…',
  'Reading {n} links and searching the web…': '正在读取 {n} 个链接并联网搜索…',
  'Searching the web…': '正在联网搜索…',

  // Sources
  'From the web': '来自网络',
  '1 page read': '读取 1 个网页',
  '{n} pages read': '读取 {n} 个网页',
  '1 search result': '1 条搜索结果',
  '{n} search results': '{n} 条搜索结果',
  '1 link not read': '1 个链接未读取',
  '{n} links not read': '{n} 个链接未读取',
  'first part only': '只用了开头部分',
  'Search: “{query}”': '搜索：“{query}”',
  'Search result': '搜索结果',
  'A link in this brief was not read: no web service is set up.': '这份需求里的 1 个链接没有读取：尚未配置联网服务。',
  '{n} links were not read: no web service is set up.': '{n} 个链接没有读取：尚未配置联网服务。',
  'The web was not searched: no web service is set up.': '没有联网搜索：尚未配置联网服务。',
  'The search found nothing to use: {error}': '搜索没有得到可用的结果：{error}',
  '1 link is read when the writing starts.': '开始写作时会读取 1 个链接。',
  '{n} links are read when the writing starts.': '开始写作时会读取 {n} 个链接。',
  '1 more link was left out: one brief reads up to 8.': '还有 1 个链接没有读取：一份需求最多读取 8 个。',
  '{n} more links were left out: one brief reads up to 8.': '还有 {n} 个链接没有读取：一份需求最多读取 8 个。',
  // What the server says about a page or a search that failed
  'the page had no text that could be read': '网页没有可读取的文字',
  'the page was not read': '网页没有读取成功',
  'no web service is set up': '尚未配置联网服务',
  'the search found nothing': '搜索没有结果',
  'the web did not answer in time': '联网服务没有及时返回',
  'The page could not be read': '网页读取失败',
  'The search found nothing': '搜索没有结果',

  // The chat
  'Search the web for this prompt. Links in a prompt are read either way.': '就这条提示联网搜索。提示里的链接无论是否开启都会读取。',
  'Web search is not set up. An administrator can add a Tavily or Firecrawl key under LLM settings, Web search.': '联网搜索尚未配置。管理员可以在“模型设置 → 联网搜索”中添加 Tavily 或 Firecrawl 的密钥。',

  // Activity
  'Read the web': '读取了网页',
  'Changed the web search settings': '修改了联网搜索设置',
});
