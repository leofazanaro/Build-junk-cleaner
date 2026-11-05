# Build Cleaner

App local (Node.js, sem dependências) que procura projetos **iOS**, **Android** e **Flutter** numa pasta, lista as pastas de build que podem ser apagadas com o tamanho de cada uma e mantém um **contador de quanto espaço já foi economizado** ao longo de todos os usos.

## Como usar

```bash
npm start
```

O navegador abre em `http://localhost:4321`. Escolha a pasta (botão **Escolher pasta…** no macOS ou digite o caminho), clique em **Escanear**, revise a lista e clique em **Deletar selecionados**.

Variáveis opcionais: `PORT=5000` (porta) e `NO_OPEN=1` (não abrir o navegador).

## O que é detectado e o que pode ser apagado

| Tipo | Detectado por | Pastas listadas |
|---|---|---|
| iOS | `*.xcodeproj`, `*.xcworkspace` ou `Podfile` | `build/`, `DerivedData/` local, `.build/` (SwiftPM), DerivedData global em `~/Library/Developer/Xcode/DerivedData` ligado ao projeto, `Pods/` *(opcional)* |
| Android | `settings.gradle(.kts)` ou `build.gradle` + `gradlew`, com plugin Android | `.gradle/`, `.kotlin/`, `build/` da raiz e de cada módulo, `.cxx/` e `.externalNativeBuild/` (NDK) |
| Flutter | `pubspec.yaml` com `sdk: flutter` | `build/`, `.dart_tool/` |

Itens marcados como **opcional** (ex.: `Pods`) não vêm selecionados por padrão, porque recriá-los exige baixar dependências de novo.

## Contador de economia

Cada limpeza é registrada em `~/.build-cleaner/stats.json` (total liberado, número de pastas e histórico das últimas 200 limpezas). O total aparece no topo do app e o histórico em **Ver histórico**.

## Segurança

- Por padrão as pastas vão para a **Lixeira** (macOS: `/usr/bin/trash` no macOS 15+ ou o Finder; Linux: `gio trash`), e o espaço só é liberado quando ela for esvaziada. Desmarque **Mover para a Lixeira** no rodapé para apagar permanentemente.
- Antes de confirmar, o app avisa se Xcode, Android Studio ou daemons do Gradle estão abertos e oferece um botão para encerrar os daemons do Gradle (SIGTERM, só processos do seu usuário).
- O scan não sai do volume da pasta escolhida (não entra em discos externos ou de rede) e pula pastas de sistema como `/System`, `/Volumes`, `/private` e `/usr`, a menos que você escolha uma delas como raiz.
- O servidor só aceita conexões de `127.0.0.1` e recusa requisições vindas de outros sites. Toda rota `/api/*` exige um token aleatório gerado a cada execução e injetado na página (se reiniciar o servidor, recarregue a aba).
- A confirmação lista cada pasta que será apagada e avisa quando há itens selecionados escondidos pelo filtro atual.
- O contador é gravado de forma atômica; se `stats.json` estiver corrompido, uma cópia `stats.corrupt-<data>.json` é preservada antes de recomeçar.
- Só é possível deletar caminhos que apareceram no último scan e cujo nome é uma pasta de build conhecida.
