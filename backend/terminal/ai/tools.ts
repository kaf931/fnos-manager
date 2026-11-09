import { inputRecord } from '../../errors.js';
import type { AiSkillCall } from '../../domain/ai-skills.js';
import type { AiToolCall } from '../../domain/ai.js';
import { validateAiCommand } from './command.js';
export interface AiFunctionTool {
  type: 'function';
  function: { name: string; description: string; parameters: unknown };
}
export const AI_TOOLS: readonly AiFunctionTool[] = [
  {
    type: 'function',
    function: {
      name: 'run_ssh_command',
      description:
        '提出 SSH 命令，由应用按照用户选择的审核或静默权限执行。每次 exec 是独立 shell，需要目录时请显式 cd。',
      parameters: {
        type: 'object',
        properties: { command: { type: 'string' }, explanation: { type: 'string' } },
        required: ['command', 'explanation'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_skill',
      description:
        '按名称读取用户已启用的技能正文。仅限当前技能目录；读取不会执行命令，也不能改变审核或静默权限。',
      parameters: {
        type: 'object',
        properties: { name: { type: 'string', description: '技能目录中的精确名称' } },
        required: ['name'],
        additionalProperties: false,
      },
    },
  },
];
(AI_TOOLS as AiFunctionTool[]).push(
  {
    type: 'function',
    function: {
      name: 'inspect_skill_package',
      description:
        '按用户要求检查当前聊天的 ZIP 附件或 HTTPS 技能包链接。传 attachmentId、url 或 official:true 三者之一。只解析，不执行脚本、不安装；返回预览标识和真实名称。',
      parameters: {
        type: 'object',
        properties: {
          attachmentId: { type: 'string' },
          url: { type: 'string' },
          official: { type: 'boolean' },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'install_skill_package',
      description:
        '安装并启用刚检查过的技能包，遵循当前审核/静默模式。不执行包内脚本；同名已存在时拒绝覆盖。',
      parameters: {
        type: 'object',
        properties: { previewId: { type: 'string' }, explanation: { type: 'string' } },
        required: ['previewId', 'explanation'],
        additionalProperties: false,
      },
    },
  },
);
const resourceProperties = { name: { type: 'string' }, revision: { type: 'integer', minimum: 1 } };
for (const name of [
  'list_skill_resources',
  'read_skill_resource',
  'prepare_skill_runtime',
] as const) {
  const extra =
    name === 'read_skill_resource'
      ? { path: { type: 'string' }, offset: { type: 'integer', minimum: 0 } }
      : name === 'prepare_skill_runtime'
        ? { explanation: { type: 'string' } }
        : {};
  (AI_TOOLS as AiFunctionTool[]).push({
    type: 'function',
    function: {
      name,
      description:
        name === 'prepare_skill_runtime'
          ? '准备当前 SSH 上的技能包和官方运行时，需要用户审核；返回包的绝对路径。'
          : '读取已启用技能包资源；使用 read_skill 返回的修订号。',
      parameters: {
        type: 'object',
        properties: { ...resourceProperties, ...extra },
        required: ['name', 'revision', ...Object.keys(extra)],
        additionalProperties: false,
      },
    },
  });
}
export type AiParsedCall =
  | {
      id: string;
      name: 'inspect_skill_package';
      args: { attachmentId?: string; url?: string; official?: true };
    }
  | { id: string; name: 'install_skill_package'; args: { previewId: string; explanation: string } }
  | { id: string; name: 'run_ssh_command'; args: { command: string; explanation: string } }
  | { id: string; name: 'read_skill'; args: { name: string } }
  | { id: string; name: 'list_skill_resources'; args: { name: string; revision: number } }
  | {
      id: string;
      name: 'read_skill_resource';
      args: { name: string; revision: number; path: string; offset: number };
    }
  | {
      id: string;
      name: 'prepare_skill_runtime';
      args: { name: string; revision: number; explanation: string };
    };
export function parseAiCall(id: unknown, name: unknown, value: unknown): AiParsedCall {
  if (typeof id !== 'string' || !id || id.length > 200) throw Error('工具调用标识无效');
  const args = inputRecord(value);
  if (name === 'inspect_skill_package') {
    if (
      Object.keys(args).some((k) => !['attachmentId', 'url', 'official'].includes(k)) ||
      Object.keys(args).length !== 1 ||
      !(
        (typeof args.attachmentId === 'string' &&
          args.attachmentId.length > 0 &&
          args.attachmentId.length <= 100) ||
        (typeof args.url === 'string' &&
          args.url.length <= 2048 &&
          args.url.startsWith('https://')) ||
        args.official === true
      )
    )
      throw Error('技能包来源无效');
    return { id, name, args: args as { attachmentId?: string; url?: string; official?: true } };
  }
  if (name === 'install_skill_package') {
    if (
      Object.keys(args).some((k) => !['previewId', 'explanation'].includes(k)) ||
      typeof args.previewId !== 'string' ||
      !/^[a-f0-9-]{36}$/.test(args.previewId) ||
      typeof args.explanation !== 'string' ||
      !args.explanation.trim() ||
      Buffer.byteLength(args.explanation) > 2000
    )
      throw Error('技能安装参数无效');
    return { id, name, args: { previewId: args.previewId, explanation: args.explanation } };
  }
  if (name === 'run_ssh_command') {
    if (
      Object.keys(args).some((k) => !['command', 'explanation'].includes(k)) ||
      typeof args.explanation !== 'string' ||
      !args.explanation.trim() ||
      Buffer.byteLength(args.explanation) > 2000
    )
      throw Error('命令调用格式无效');
    return {
      id,
      name,
      args: { command: validateAiCommand(args.command), explanation: args.explanation },
    };
  }
  if (
    ![
      'read_skill',
      'list_skill_resources',
      'read_skill_resource',
      'prepare_skill_runtime',
    ].includes(String(name)) ||
    typeof args.name !== 'string' ||
    args.name.length > 64 ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(args.name)
  )
    throw Error('技能调用格式无效');
  const keys = [
    'name',
    ...(name === 'read_skill' ? [] : ['revision']),
    ...(name === 'read_skill_resource' ? ['path', 'offset'] : []),
    ...(name === 'prepare_skill_runtime' ? ['explanation'] : []),
  ];
  if (Object.keys(args).some((k) => !keys.includes(k))) throw Error('技能参数无效');
  if (name === 'read_skill') return { id, name, args: { name: args.name } };
  if (!Number.isSafeInteger(args.revision) || Number(args.revision) < 1)
    throw Error('技能修订无效');
  const revision = Number(args.revision);
  if (name === 'list_skill_resources') return { id, name, args: { name: args.name, revision } };
  if (name === 'read_skill_resource') {
    if (
      typeof args.path !== 'string' ||
      args.path.length > 512 ||
      !Number.isSafeInteger(args.offset) ||
      Number(args.offset) < 0
    )
      throw Error('资源参数无效');
    return {
      id,
      name,
      args: { name: args.name, revision, path: args.path, offset: Number(args.offset) },
    };
  }
  if (
    typeof args.explanation !== 'string' ||
    !args.explanation.trim() ||
    Buffer.byteLength(args.explanation) > 2000
  )
    throw Error('准备说明无效');
  return {
    id,
    name: 'prepare_skill_runtime',
    args: { name: args.name, revision, explanation: args.explanation },
  };
}
export function splitAiCalls(calls: AiParsedCall[]): {
  toolCalls: AiToolCall[];
  skillCalls?: AiSkillCall[];
} {
  const toolCalls: AiToolCall[] = [],
    skillCalls: AiSkillCall[] = [];
  for (const c of calls) {
    if (c.name === 'run_ssh_command') toolCalls.push({ id: c.id, ...c.args });
    else if (c.name === 'inspect_skill_package')
      skillCalls.push({ id: c.id, skillName: '', action: c.name, source: c.args });
    else if (c.name === 'install_skill_package')
      toolCalls.push({
        id: c.id,
        kind: c.name,
        previewId: c.args.previewId,
        command: '安装技能包',
        explanation: c.args.explanation,
      });
    else if (c.name === 'prepare_skill_runtime')
      toolCalls.push({
        id: c.id,
        kind: c.name,
        skill: { name: c.args.name, revision: c.args.revision },
        command: '准备技能运行环境：' + c.args.name + ' · 修订 ' + c.args.revision,
        explanation: c.args.explanation,
      });
    else
      skillCalls.push({
        id: c.id,
        skillName: c.args.name,
        action: c.name,
        ...(c.name !== 'read_skill' ? { revision: c.args.revision } : {}),
        ...(c.name === 'read_skill_resource' ? { path: c.args.path, offset: c.args.offset } : {}),
      });
  }
  return { toolCalls, ...(skillCalls.length ? { skillCalls } : {}) };
}
export function protocolAiCalls(calls: AiParsedCall[]) {
  return calls.map((c) => ({
    id: c.id,
    type: 'function' as const,
    function: { name: c.name, arguments: JSON.stringify(c.args) },
  }));
}
