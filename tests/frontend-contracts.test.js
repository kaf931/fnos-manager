import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { auditFrontendSources, auditSourceText } from '../scripts/audit-frontend-contracts.js';
const root = fileURLToPath(new URL('../', import.meta.url));

test('every frontend source participates in strict TypeScript without suppression or imperative HTML rendering', async () => {
  const config = JSON.parse(await readFile(path.join(root, 'tsconfig.web.json'), 'utf8'));
  assert.equal(config.compilerOptions.strict, true);
  assert.equal(config.compilerOptions.allowJs, false);
  assert.ok(config.include.includes('web/**/*.ts'));
  assert.ok(config.include.includes('web/**/*.tsx'));
  for (const option of [
    'noImplicitAny',
    'strictNullChecks',
    'strictFunctionTypes',
    'strictBindCallApply',
    'strictPropertyInitialization',
    'useUnknownInCatchVariables',
  ])
    assert.notEqual(
      config.compilerOptions[option],
      false,
      `${option} must not disable strict checking`,
    );
  const { count, failures } = await auditFrontendSources(root);
  assert.ok(count > 80, 'the audit must cover the entire frontend');
  assert.deepEqual(failures, []);
});

test('frontend source gate catches unsafe regressions while allowing the isolated Markdown sanitizer', () => {
  assert.equal(
    auditSourceText(
      '/project/web/unsafe.ts',
      'const body: any = {}; body.innerHTML = "<b>unsafe</b>";',
    ).length,
    2,
  );
  assert.equal(
    auditSourceText(
      '/project/web/unsafe.ts',
      '// @ts-ignore\nconst x = value as unknown as string;',
    ).length,
    2,
  );
  assert.equal(
    auditSourceText('/project/web/unsafe.ts', 'element.insertAdjacentHTML("beforeend", markup);')
      .length,
    1,
  );
  assert.deepEqual(
    auditSourceText('/project/web/ai-markdown.ts', 'template.innerHTML = sanitized;'),
    [],
  );
  assert.equal(
    auditSourceText('/project/web/ai-markdown.ts', 'element.innerHTML = untrusted;').length,
    1,
  );
});

test('frontend gate rejects legacy surfaces and direct business DOM mutations', () => {
  for (const source of [
    'createSurface(host).render(view);',
    'const view=<SurfaceHost as="section"/>;',
    'document.createElement("section");',
    'host.textContent="Ready";',
    'host.hidden=true;',
    'input.checked=true;',
    'input.value="draft";',
    'button.onclick=save;',
    'host.classList.toggle("selected",active);',
    'host.setAttribute("aria-expanded","true");',
    'host.replaceChildren();',
    'row.remove();',
    'document.createTextNode("value");',
    'button.addEventListener("click",save);',
    'host.style.top="10px";',
    'host.dataset.active="true";',
    'createRoot(host).render(view);',
  ])
    assert.ok(auditSourceText('/project/web/feature.tsx', source).length, source);
  assert.deepEqual(
    auditSourceText(
      '/project/web/feature.tsx',
      'const view=<section hidden={!active}><button onClick={save}>Save</button></section>;',
    ),
    [],
  );
  assert.deepEqual(
    auditSourceText('/project/web/wake-batch.tsx', 'el.indeterminate=some&&!all;'),
    [],
  );
  assert.deepEqual(auditSourceText('/project/web/terminal-ai.tsx', "e.target.value='';"), []);
  assert.ok(
    auditSourceText('/project/web/terminal-ai.tsx', "e.target.value='business draft';").length,
  );
  assert.deepEqual(
    auditSourceText('/project/web/terminal-view.tsx', 'ws.onmessage=handleMessage;'),
    [],
  );
  assert.ok(
    auditSourceText('/project/web/terminal-view.tsx', 'button.onclick=handleMessage;').length,
  );
  assert.deepEqual(
    auditSourceText(
      '/project/web/terminal-transfers.tsx',
      "const link=document.createElement('a');",
    ),
    [],
  );
  assert.ok(
    auditSourceText(
      '/project/web/terminal-transfers.tsx',
      "const host=document.createElement('div');",
    ).length,
  );
});

function fixtureDiagnostics(source) {
  const filename = path.join(root, 'tests/.frontend-contract-fixture.ts');
  const options = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    jsx: ts.JsxEmit.ReactJSX,
    esModuleInterop: true,
    lib: ['lib.es2022.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'],
  };
  const host = ts.createCompilerHost(options),
    read = host.readFile.bind(host),
    exists = host.fileExists.bind(host);
  host.readFile = (file) => (path.resolve(file) === filename ? source : read(file));
  host.fileExists = (file) => path.resolve(file) === filename || exists(file);
  const program = ts.createProgram([filename], options, host);
  return ts
    .getPreEmitDiagnostics(program)
    .filter((diagnostic) => diagnostic.file?.fileName === filename)
    .map((diagnostic) => ({
      line: diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start).line + 1,
      message: ts.flattenDiagnosticMessageText(diagnostic.messageText, ' '),
    }));
}
const imports = `import type {ApiClient} from '../web/contracts/shared.js';
import type {AiSnapshot,AiProviderInput} from '../web/contracts/ai.js';
import type {CommandEntry} from '../web/contracts/commands.js';
import type {SessionIdentity} from '../web/contracts/terminal.js';
import type {NativeSelectProps} from '../web/native-select.js';
declare const api: ApiClient;
`;

test('public frontend contracts reject wrong API DTOs, props, methods and SSH session IDs', () => {
  assert.deepEqual(
    fixtureDiagnostics(
      imports +
        `const provider: AiProviderInput={name:'Local',protocol:'ollama',baseUrl:'http://localhost:11434',model:'local'};
const command: CommandEntry={id:'c',command:'pwd',description:'目录',category:'系统'};
const session: SessionIdentity={id:'ssh',generation:1,connected:true};
const props: NativeSelectProps={value:'review',onChange:value=>value.toUpperCase()};
const snapshot=await api<AiSnapshot>('/terminal/sessions/ssh/ai/conversation');
snapshot.messages.map(message=>message.content);
`,
    ),
    [],
  );
  const invalid = fixtureDiagnostics(
    imports +
      `const provider: AiProviderInput={name:'Local',protocol:'unsupported',baseUrl:'http://localhost',model:'m'};
const command: CommandEntry={id:'c',command:42,description:'目录',category:'系统'};
const session: SessionIdentity={id:42,generation:1,connected:true};
const props: NativeSelectProps={value:42,onChange:(value:number)=>{}};
const snapshot=await api<AiSnapshot>('/terminal/sessions/ssh/ai/conversation','FETCH');
const permission: AiSnapshot['executionMode']='auto';
const untyped=await api('/terminal/ai/providers');
untyped.messages;
`,
  );
  for (const line of [7, 8, 9, 10, 11, 12, 14])
    assert.ok(
      invalid.some((diagnostic) => diagnostic.line === line),
      `invalid contract on fixture line ${line} must fail: ${JSON.stringify(invalid)}`,
    );
});

test('React page contracts require real service/state props instead of generated DOM IDs', () => {
  const prefix = `import type {ComponentProps} from 'react';
import {TasksPage} from '../web/features/tasks/page.js';
import {WakePage} from '../web/features/wake/page.js';
import type {ApiClient,AppState} from '../web/contracts/shared.js';
declare const api:ApiClient; declare const state:AppState;
`;
  assert.deepEqual(
    fixtureDiagnostics(
      prefix +
        `const tasks:ComponentProps<typeof TasksPage>={services:{api,toast:()=>{}},state,active:true};
const wake:ComponentProps<typeof WakePage>={services:{api,toast:()=>{}},active:false};`,
    ),
    [],
  );
  const errors = fixtureDiagnostics(
    prefix +
      `const tasks:ComponentProps<typeof TasksPage>={services:{api,toast:()=>{}},state,active:'tasks'};
const wake:ComponentProps<typeof WakePage>={initialPage:'wake'};`,
  );
  assert.ok(errors.some((e) => e.line === 6));
  assert.ok(errors.some((e) => e.line === 7));
});
