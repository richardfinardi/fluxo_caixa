# Fluxo de Caixa RF — Android

APK Android do sistema funcional existente:
https://richardfinardi.github.io/fluxo_caixa/

O app abre o sistema completo dentro do Android (dashboard, lançamentos,
recorrências, pagamentos, conciliação bancária, relatórios e demais telas).
Atualizações do site entram no app sem reinstalar o APK.

## Widget
- Resumo compacto 2×2, fundo translúcido, com saldo real, a receber e a pagar.
- Saldo e pendências seguem as mesmas regras da tela Cockpit:
  até hoje, consolidado vs. não consolidado, excluindo "pago no cartão".
- Consulta direta ao Apps Script já usado pelo site, sem banco paralelo.
- Atualização manual ↻ e automática pelo Android a cada ~15 minutos
  (pode sofrer atraso por economia de bateria).
- Guarda somente totais e última atualização no armazenamento privado.
- Toque nos valores abre o app.

## Como instalar
Acesse Releases deste repositório, baixe o último **FluxoCaixaRF.apk**,
instale e abra. Depois segure um espaço vazio na tela inicial do Android,
selecione Widgets, Fluxo de Caixa RF e adicione o cartão 2×2.

## Compilar
Requisitos: Java 17, SDK Android 35 e Gradle 8.11.1.

    gradle --no-daemon -p android :app:assembleDebug

O workflow do GitHub Actions compila e publica o APK nos Releases. A versão
inicial usa certificado de teste. O cache do workflow tenta conservar essa
assinatura para as atualizações; o ideal no futuro é uma chave estável de release.

## Privacidade
O app não envia dados para GitHub nem cria JSON público. Reusa a API existente.
O acesso à própria implantação pública do Apps Script deve ser avaliado
se for necessário proteger os dados contra acesso externo.
