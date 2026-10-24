# Mods para Claude Code

[English](README.md) · [Русский](README.ru.md) · [简体中文](README.zh-CN.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Español](README.es.md) · **Português** · [Deutsch](README.de.md) · [Français](README.fr.md)

## plan-progress

Barras de progresso ao vivo acima do campo de entrada do Claude Code. O Claude divide a tarefa em etapas e passos, e a barra avança conforme ele trabalha. Os subagentes de cada tarefa aparecem abaixo da barra.

![plan-progress: duas tarefas com seus agentes, uma pergunta, um erro, um plano reescrito no meio, as duas tarefas concluídas](media/plan-progress.gif)

[Assistir com som (MP4, 14 s)](media/plan-progress.mp4)

- Uma linha por tarefa: estado, título, barra, porcentagem, botão de fechar
- A etiqueta na barra mostra a etapa e o passo atuais; ao passar o mouse, o tempo decorrido
- Etapas são cápsulas e passos são pontos; ao passar o mouse sobre um já alcançado, mostra quanto tempo levou, e sobre um à frente, o que começa ali
- Uma barra concluída fica verde, mostra o tempo total e fica até ser fechada; com `/plan-progress-autoclose` ativado, some após `doneBarSeconds` (30 s por padrão, em `/config`)
- Os pontos do preenchimento e das linhas de subagentes cintilam; desative `twinkle` em `/config` para desenhá-los parados
- Quatro estados: em andamento, aguardando resposta, erro, concluído
- Cada subagente tem uma linha sob sua tarefa: nome, modelo e effort, ferramenta atual, tempo
- O plano pode mudar durante o trabalho; os passos concluídos são mantidos pelo título
- As barras são salvas por sessão e voltam quando a sessão é retomada
- Sons curtos para pergunta, erro e conclusão
- O rodapé mostra a velocidade com que a conversa principal escreve, `⚡ N tok/s`; subagentes não contam
- O ⚙ ao lado (no app de desktop e no terminal em tela cheia) abre uma janela de configurações: efeitos, fechamento automático e seus segundos, sons, o próprio número, a versão do mod e a busca por atualizações; `/plan-progress-settings` a abre em qualquer lugar. A janela usa o idioma do `/config`; se não houver, o do app ou o do sistema
- Atualizações: clicar na versão na janela de configurações procura uma versão nova, e «Atualizar» a instala e recarrega o mod na hora (se a recarga não funcionar, pede para reiniciar). A cada 6 horas o mod também verifica sozinho e marca o ⚙ com 🔹 (● no terminal) quando sai uma versão nova. Cada verificação é uma única requisição à API do GitHub (`api.github.com/repos/zycck/claude-mods/releases`), sem dados da conta ou da sessão; desligue em «Procurar atualizações» na janela ou com `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`. Uma cópia instalada de uma pasta não é verificada
- Funciona no app de desktop e no terminal
- No terminal a barra segue o modo claro ou escuro do GNOME com o tema `auto` e usa as cores do tema ativo do Omarchy

### Instalação

Requer o Claude Code 2.1.295 ou mais recente (`claude --version`; atualize com `claude update`). Em versões anteriores parte do mod não funciona: a janela de configurações fica vazia e, antes da 2.1.286, o módulo de hooks nem carrega, nenhuma barra aparece e na inicialização aparece `plan-progress: hooks module did not load`.

```
/plugin marketplace add zycck/claude-mods
/plugin install plan-progress@zycck-mods
```

Atualização:

```
claude plugin marketplace update zycck-mods
claude plugin update plan-progress@zycck-mods
```

### Comandos

- `/progress` mostra ou oculta as barras
- `/progress-clear` remove todas as barras
- `/progress-agents` recolhe as faixas de agentes sob as barras ou as mostra de novo (o botão de seta ao lado do ✕ de uma barra faz isso só para ela)
- `/plan-progress-autoclose` ativa o fechamento automático das barras concluídas (desativado por padrão) ou o desativa de novo; a escolha é mantida entre sessões
- `/plan-progress-settings` abre a janela de configurações, como o ⚙ do rodapé (no terminal o ⚙ só aparece em tela cheia)

### Como funciona

O mod registra a ferramenta `plan_progress`. O Claude envia o plano uma vez e depois atualizações curtas, como `{id, next: true}` ou `{id, done: ["Routes"]}`. Um nome de passo desconhecido é recusado com a lista de passos da barra. Um plano aprovado no plan mode vira a barra `plan`. As linhas dos agentes vêm dos eventos do motor e não gastam tokens.

No app de desktop a barra é uma imagem SVG com uma camada de hover por cima. No terminal é uma grade de caracteres que só anima enquanto o Claude trabalha.

### Testes

`plugins/plan-progress/tests` executa o módulo real sobre um motor simulado: `node compile.cjs ../hooks/register.tsx register.mjs`, depois `node regress.mjs` e `node scenarios.mjs`.

## Licença

MIT
