# Fluxo de Caixa RF — Android nativo 1.2.0

**Aplicativo nativo:** a Activity principal usa `LinearLayout`, `ScrollView`, `TextView`, `EditText`, `Spinner` e `AlertDialog`. Não utiliza WebView nem abre o site como interface.

## Funcionalidades nativas
- Início: saldo consolidado, títulos pendentes, previsões de 30 dias e vencimentos.
- Lançamentos: busca, filtros, cadastrar, editar, liquidar, adiar, excluir e pagar despesas no cartão.
- Banco: visualizar movimentos Pluggy, conciliar 1:1, criar lançamento a partir do banco e ignorar movimento (com confirmação).
- Cartões: faturas, limites, vencimentos e compras vinculadas.
- Recorrências: consultar e criar mensal ou semanal.
- Widget Android: 2x2, translúcido, saldo real, a receber e a pagar, atualização manual e automática.
- Cache privado e leitura offline dos últimos dados sincronizados.

**Não implementado na interface nativa desta versão:** conciliação N:N, simulação de datas, todas as configurações avançadas, horas, relatórios PDF e importações manuais Pluggy. Essas rotinas continuam existindo no backend, mas ainda não têm tela nativa. Não confundir com equivalência total ao sistema web.

## Integração
Usa a mesma implantação Apps Script do fluxo original por GET/POST. Nenhuma tabela, cadastro ou lançamento foi migrado. Todas as gravações vão para a API existente.

## APK
O workflow `.github/workflows/android-fluxo-caixa.yml` compila e publica a versão `FluxoCaixaRF.apk` na aba Releases do GitHub.

**Atenção:** o Apps Script atual permite consulta de dados no endpoint existente; revise controle de acesso antes de distribuir o APK a terceiros. Nesta atualização não alteramos o backend nem introduzimos dados no GitHub.
