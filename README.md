# Twitch Live Translator

Extensao Manifest V3 para Chrome e Microsoft Edge que traduz, quase em tempo real, mensagens novas do chat da Twitch. A alteracao acontece somente na visualizacao local do navegador: a Twitch nao recebe mensagem modificada e o envio de chat continua intacto.

## Estado atual

O projeto ja funciona em uso real na Twitch, mas ainda nao esta perfeito. A traducao local depende das APIs nativas do navegador e algumas frases curtas, girias, contexto de jogo e mensagens muito fragmentadas podem sair estranhas.

Este print mostra o estado atual da extensao em uma live real:

![Twitch Live Translator em uso, mostrando traducoes automaticas ainda com pontos a refinar](docs/screenshots/translation-current-state.png)

Contribuicoes sao bem-vindas, principalmente em areas que ainda precisam de refinamento:

- qualidade de traducao em mensagens curtas e com girias;
- heuristicas para detectar quando nao vale traduzir;
- suporte a mais variacoes do DOM da Twitch;
- UX do popup e feedback de download dos modelos;
- testes reais em Chrome, Edge e popout chat.

## Funcionalidades

- Detecta novas mensagens com `MutationObserver`, sem polling fixo.
- Extrai o texto da mensagem sem username, badges, timestamp e botoes.
- Preserva a estrutura original do chat, incluindo emotes, links e mencoes.
- Usa `LanguageDetector` e `Translator` nativos do navegador quando disponiveis.
- Ignora mensagens vazias, URLs isoladas, mensagens muito curtas e tokens como `GG`, `WP`, `LUL`, `KEKW` e `Pog`.
- Evita processamento repetido com `data-tlt-processed`.
- Cache LRU simples com limite de 750 traducoes.
- Fila com ate 3 traducoes simultaneas e aviso visual se houver overflow.
- Inicia a preparacao dos modelos e a traducao ao encontrar o chat, inclusive ao trocar de live sem recarregar a Twitch.
- Retoma modelos bloqueados por ativacao ao clicar ou pressionar uma tecla normalmente na Twitch, sem abrir o popup.
- Popup compacto com apenas o idioma de destino e menu recolhido de configuracoes.
- Modos de exibicao, filtros, status das APIs e botao de manutencao `Preparar modelos locais` dentro de `Configuracoes`.
- Configuracoes persistidas com `chrome.storage.sync`.

## Modos de exibicao

1. `Original + traducao`: mostra a mensagem original e a traducao abaixo.
2. `Somente traducao`: oculta visualmente o corpo original e mostra a traducao.
3. `Traducao + original`: oculta visualmente o corpo original e mostra traducao com o texto original entre parenteses.

## Arquitetura

- `src/content/content.js`: inicializacao, observers, fluxo de processamento e integracao com storage.
- `src/content/twitchChat.js`: selectors e manipulacao segura do DOM da Twitch.
- `src/content/translationQueue.js`: controle de concorrencia e overflow.
- `src/services/translationService.js`: fachada para providers de traducao.
- `src/services/browserTranslator.js`: provider local usando `Translator` e `LanguageDetector`.
- `src/shared/constants.js`: configuracoes padrao, selectors e listas editaveis.
- `src/shared/settings.js`: leitura e escrita de configuracoes.
- `src/shared/utils.js`: logs, filtros, cache e normalizacao.
- `src/popup/*`: interface da extensao.

## Requisitos

- Chrome ou Edge Chromium em desktop.
- Manifest V3 habilitado, padrao nas versoes atuais.
- Para traducao local: navegador com suporte a `Translator API` e `Language Detector API`.

As APIs nativas sao experimentais/limitadas. A documentacao do Chrome informa que `Translator.availability()` verifica disponibilidade do par de idiomas e que o modelo pode ser baixado no primeiro uso. A MDN tambem destaca que `Translator` e `LanguageDetector` ainda nao sao Baseline e podem depender de contexto seguro, Permissions Policy e interacao recente do usuario.

Referencias:

- https://developer.chrome.com/docs/ai/translator-api
- https://developer.chrome.com/docs/ai/language-detection
- https://developer.mozilla.org/en-US/docs/Web/API/Translator_and_Language_Detector_APIs

## Instalacao manual no Chrome

1. Abra `chrome://extensions`.
2. Ative `Developer mode` no canto superior direito.
3. Clique em `Load unpacked`.
4. Selecione a pasta deste projeto: `Tradutor de chat`.
5. Abra uma pagina da Twitch com chat.

## Instalacao manual no Microsoft Edge

1. Abra `edge://extensions`.
2. Ative `Developer mode`.
3. Clique em `Load unpacked`.
4. Selecione a pasta deste projeto.
5. Abra a Twitch normalmente.

## Como testar na Twitch

1. Abra `https://www.twitch.tv/<canal>` com o chat visivel.
2. Aguarde mensagens em outro idioma: a traducao automatica vem ligada por padrao e inicia sem abrir a extensao.
3. No primeiro uso, se o navegador exigir ativacao para baixar os modelos, uma interacao normal na Twitch (clique ou tecla) faz a extensao tentar novamente.
4. Abra o popup apenas para escolher outro idioma de destino. A escolha fica salva para as proximas lives.
5. Abra `Configuracoes` para mudar o modo de exibicao, filtros ou desativar a traducao. Desativar restaura as mensagens originais.
6. Troque de canal pela propria Twitch e confirme que o novo chat continua sendo traduzido.
7. Teste tambem o popout em URLs como `https://www.twitch.tv/popout/<canal>/chat?popout=`.

Ao atualizar a extensao carregada manualmente, clique em recarregar na pagina de extensoes e recarregue uma vez as abas da Twitch ja abertas, para carregar os scripts novos.

## Download inicial dos modelos

Quando a Translator API ou a Language Detector API retorna `downloadable` ou `downloading`, o navegador pode baixar modelos locais. A extensao exibe esse estado no popup e impede criacoes duplicadas para o mesmo par de idiomas usando promises compartilhadas.

A preparacao comeca automaticamente quando o chat aparece. O detector e o tradutor sao inicializados juntos. O par inicial e `en -> idioma de destino`, ou `es -> en` quando o destino e ingles. Outros idiomas podem exigir modelos adicionais quando aparecerem.

Se a API exigir ativacao do usuario, a extensao aguarda uma interacao normal na pagina e retoma os modelos pendentes e as mensagens ainda visiveis. Ela nao simula cliques nem consegue remover uma exigencia do navegador. Depois de os modelos estarem disponiveis para o contexto da Twitch, a traducao pode iniciar automaticamente nas proximas lives.

O botao `Preparar modelos locais`, dentro de `Configuracoes`, fica disponivel como manutencao manual. Ele tambem pede que as abas da Twitch tentem novamente, sem exigir recarregamento para essa tentativa.

## Limitacoes conhecidas

- Se `Translator` ou `LanguageDetector` nao existirem no navegador/contexto da pagina, a extensao nao traduz e mostra o status como indisponivel.
- Algumas versoes do Chrome podem exigir flags, suporte de hardware, disponibilidade regional ou interacao recente do usuario para criar os modelos.
- O primeiro uso ou um novo par de idiomas pode exigir uma interacao na Twitch antes do download. Abrir a live por URL, sozinho, nao garante ativacao do usuario.
- Com `Detectar idioma automaticamente` desligado, o idioma de origem e considerado ingles.
- O DOM da Twitch muda com frequencia. Selectors tolerantes foram usados, mas podem precisar de ajuste.
- A opcao `Preservar emotes` existe porque essa versao nunca substitui o `innerHTML` da mensagem; ela e mantida como preferencia para evolucoes futuras.
- Sem provider externo. Nao ha API keys no projeto e mensagens nao sao enviadas a um servidor de traducao.

## Testes automatizados

As dependencias de desenvolvimento servem apenas para testes; a extensao continua em JavaScript puro, sem build ou dependencias em tempo de execucao.

```powershell
npm install
$env:TLT_BROWSER_CHANNEL = "msedge"
npm test
```

Para usar o Chromium do Playwright em vez do Edge instalado, execute `npx playwright install chromium` e rode `npm test` sem `TLT_BROWSER_CHANNEL`.

Os testes usam um DOM de chat e APIs nativas simuladas dentro de um navegador real. Cobrem inicio automatico, chat tardio, troca de live, ativacao, mensagens pendentes, troca de idioma, desativacao e o popup. Eles nao validam a qualidade dos modelos reais nem a compatibilidade com o DOM atual da Twitch. Screenshots do popup ficam em `test-results/`.

O icone de configuracoes vem do [Lucide](https://lucide.dev), com licenca em `docs/lucide-license.txt`.

## Como alterar selectors da Twitch

Edite `src/shared/constants.js`, objeto `TLT.TWITCH_SELECTORS`.

- `chatContainer`: regioes observadas pelo `MutationObserver`.
- `message`: elementos tratados como mensagens individuais.
- `messageBody`: possiveis containers do texto da mensagem.
- `excludeFromText`: elementos removidos da copia usada apenas para extrair texto.

## Estrutura de arquivos

```text
.
|-- manifest.json
|-- README.md
|-- LICENSE
|-- docs/
|   `-- screenshots/
|       `-- translation-current-state.png
|-- icons/
|   |-- icon16.png
|   |-- icon32.png
|   |-- icon48.png
|   `-- icon128.png
`-- src/
    |-- content/
    |   |-- content.css
    |   |-- content.js
    |   |-- translationQueue.js
    |   `-- twitchChat.js
    |-- services/
    |   |-- browserTranslator.js
    |   `-- translationService.js
    |-- shared/
    |   |-- constants.js
    |   |-- settings.js
    |   `-- utils.js
    `-- popup/
        |-- popup.css
        |-- popup.html
        `-- popup.js
```
