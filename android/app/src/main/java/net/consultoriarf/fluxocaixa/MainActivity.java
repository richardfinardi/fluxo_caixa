package net.consultoriarf.fluxocaixa;

import android.app.Activity;
import android.app.AlertDialog;
import android.app.DatePickerDialog;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Bundle;
import android.text.Editable;
import android.text.InputType;
import android.text.TextWatcher;
import android.view.Gravity;
import android.view.View;
import android.widget.ArrayAdapter;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.Spinner;
import android.widget.TextView;
import android.widget.Toast;
import org.json.JSONArray;
import org.json.JSONObject;
import java.text.NumberFormat;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.Collections;
import java.util.Comparator;
import java.util.Date;
import java.util.List;
import java.util.Locale;

public final class MainActivity extends Activity {
    private static final int NAVY = Color.rgb(18, 30, 49);
    private static final int PANEL = Color.rgb(29, 46, 68);
    private static final int BG = Color.rgb(245, 248, 251);
    private static final int INK = Color.rgb(28, 44, 62);
    private static final int MUTED = Color.rgb(103, 119, 140);
    private static final int GREEN = Color.rgb(9, 134, 96);
    private static final int RED = Color.rgb(196, 70, 79);
    private static final int BLUE = Color.rgb(45, 107, 166);
    private static final Locale BR = new Locale("pt", "BR");
    private static final String[] TABS = {"Início", "Lançamentos", "Banco", "Cartões", "Recorrências"};

    private JSONObject data, bank, cards;
    private LinearLayout root, top, content, nav, transactionsList;
    private TextView statusText;
    private EditText search;
    private int activeTab = 0;
    private boolean loading = false;
    private String term = "";
    private String mode = "Todos";

    private int dp(float px) { return (int)(px * getResources().getDisplayMetrics().density + 0.5f); }
    private String today() { return new SimpleDateFormat("yyyy-MM-dd", BR).format(new Date()); }
    private static String str(JSONObject j, String name) { return j == null ? "" : j.optString(name, ""); }
    private static double val(JSONObject j, String name) { return j == null ? 0 : j.optDouble(name, 0); }
    private static String money(double amount) { return NumberFormat.getCurrencyInstance(BR).format(amount); }
    private static boolean paidCard(JSONObject j) {
        String s=str(j,"status").toLowerCase(BR);
        return s.equals("pago no cartao") || s.equals("pago no cartão");
    }
    private static boolean settled(JSONObject j) { return str(j,"status").equalsIgnoreCase("Consolidado"); }
    private static boolean income(JSONObject j) { return str(j,"tipo").equalsIgnoreCase("Receita"); }
    private static JSONArray list(JSONObject j, String field) { JSONArray a=j==null?null:j.optJSONArray(field); return a==null?new JSONArray():a; }
    private static JSONObject obj(JSONArray a,int i){return a.optJSONObject(i);}
    private static String niceDate(String iso) {
        return iso.length()>=10?iso.substring(8,10)+"/"+iso.substring(5,7)+"/"+iso.substring(0,4):iso;
    }
    private double parseAmount(String raw) {
        String s=raw.trim().replace("R$","").replace(" ","");
        if(s.indexOf(',')>=0)s=s.replace(".","").replace(',','.');
        return Double.parseDouble(s);
    }

    @Override public void onCreate(Bundle saved) {
        super.onCreate(saved);
        getWindow().setStatusBarColor(NAVY);
        getWindow().setNavigationBarColor(NAVY);
        data=NativeBackend.cached(this);
        root=new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(BG);
        setContentView(root);
        buildShell();
        render();
        sync();
    }

    private GradientDrawable shape(int color,int radius) {
        GradientDrawable d=new GradientDrawable();
        d.setColor(color);d.setCornerRadius(dp(radius));
        return d;
    }
    private LinearLayout column() {
        LinearLayout l=new LinearLayout(this);l.setOrientation(LinearLayout.VERTICAL);return l;
    }
    private LinearLayout line() {
        LinearLayout l=new LinearLayout(this);l.setOrientation(LinearLayout.HORIZONTAL);l.setGravity(Gravity.CENTER_VERTICAL);return l;
    }
    private TextView label(String value,int size,int color,boolean bold) {
        TextView v=new TextView(this);
        v.setText(value);v.setTextSize(size);v.setTextColor(color);
        v.setGravity(Gravity.CENTER_VERTICAL);
        if(bold)v.setTypeface(null,Typeface.BOLD);
        return v;
    }
    private Button button(String text, int color) {
        Button b=new Button(this);
        b.setAllCaps(false);b.setText(text);b.setTextSize(13);
        b.setTextColor(Color.WHITE);
        b.setBackground(shape(color,12));
        b.setPadding(dp(10),dp(5),dp(10),dp(5));
        return b;
    }
    private void buildShell() {
        top=line();top.setBackgroundColor(NAVY);
        top.setPadding(dp(18),dp(8),dp(10),dp(8));
        LinearLayout topTitles=column();
        topTitles.addView(label("FLUXO DE CAIXA",17,Color.WHITE,true));
        statusText=label("Sincronizando…",11,Color.rgb(170,190,207),false);
        topTitles.addView(statusText);
        top.addView(topTitles,new LinearLayout.LayoutParams(0,dp(48),1));
        Button update=button("↻",BLUE);
        top.addView(update,new LinearLayout.LayoutParams(dp(48),dp(43)));
        update.setOnClickListener(v->sync());
        root.addView(top,new LinearLayout.LayoutParams(-1,dp(67)));

        ScrollView scroller=new ScrollView(this);
        scroller.setFillViewport(true);
        content=column();
        content.setPadding(dp(14),dp(12),dp(14),dp(20));
        scroller.addView(content,new ScrollView.LayoutParams(-1,-2));
        root.addView(scroller,new LinearLayout.LayoutParams(-1,0,1));

        nav=line();nav.setPadding(dp(4),dp(5),dp(4),dp(5));nav.setBackgroundColor(Color.WHITE);
        root.addView(nav,new LinearLayout.LayoutParams(-1,dp(60)));
    }
    private void showMessage(String text) { Toast.makeText(this,text,Toast.LENGTH_LONG).show(); }
    private void error(String message) { new AlertDialog.Builder(this).setTitle("Não foi possível concluir").setMessage(message).setPositiveButton("OK",null).show(); }
    private void sync() {
        if(loading)return;
        loading=true;statusText.setText("Atualizando…");
        new Thread(()->{
            try {
                JSONObject fresh=NativeBackend.get();
                NativeBackend.save(this,fresh);
                runOnUiThread(()->{
                    data=fresh;loading=false;
                    statusText.setText("Sincronizado · "+new SimpleDateFormat("HH:mm",BR).format(new Date()));
                    render();
                    CashRepository.refreshAsync(getApplicationContext());
                });
            }catch(Exception e){
                runOnUiThread(()->{
                    loading=false;statusText.setText(data==null?"Falha de conexão":"Modo offline · dados em cache");
                    if(data==null)error(e.getMessage());
                    render();
                });
            }
        },"fluxo-load").start();
    }
    private void request(String fn,Object args,boolean write, java.util.function.Consumer<Object> done) {
        statusText.setText("Processando…");
        new Thread(()->{
            try {
                Object response=NativeBackend.call(fn,args,write);
                runOnUiThread(()->{
                    statusText.setText("Conectado");
                    if(write&&response instanceof JSONObject) {
                        JSONObject changed=(JSONObject)response;
                        JSONObject updated=changed.optJSONObject("dados");
                        if(updated!=null){
                            data=updated;
                            NativeBackend.save(this,updated);
                            CashRepository.refreshAsync(getApplicationContext());
                        }
                        showMessage(changed.optString("mensagem","Operação registrada."));
                        render();
                    }
                    if(done!=null)done.accept(response);
                });
                if(write) {
                    // Revalida API após escrita, mesmo quando resposta já trouxe os dados.
                    JSONObject newData=NativeBackend.get();
                    NativeBackend.save(this,newData);
                    runOnUiThread(()->{data=newData;render();CashRepository.refreshAsync(getApplicationContext());});
                }
            }catch(Exception e) {
                runOnUiThread(()->{statusText.setText("Falha de sincronização");error(e.getMessage());});
            }
        },"fluxo-api-"+fn).start();
    }
    private void render() {
        content.removeAllViews();
        nav.removeAllViews();
        for(int i=0;i<TABS.length;i++){
            final int tab=i;
            TextView t=label(TABS[i],i==4?10:11,i==activeTab?BLUE:MUTED,i==activeTab);
            t.setGravity(Gravity.CENTER);
            if(i==activeTab)t.setBackground(shape(Color.rgb(228,239,249),9));
            nav.addView(t,new LinearLayout.LayoutParams(0,-1,1));
            t.setOnClickListener(v->{
                activeTab=tab;term="";mode="Todos";render();
                if(activeTab==2&&bank==null)loadBank();
                if(activeTab==3&&cards==null)loadCards();
            });
        }
        if(data==null){
            heading("Seu fluxo de caixa");
            content.addView(label("Buscando dados do sistema. Verifique a conexão com a internet.",15,MUTED,false));
            return;
        }
        switch(activeTab){
            case 0: dashboard();break;
            case 1: transactions();break;
            case 2: showBank();break;
            case 3: showCards();break;
            default: showRecurring();
        }
    }
    private void heading(String text) {
        TextView title=label(text,21,INK,true);
        title.setPadding(dp(4),dp(8),dp(4),dp(12));
        content.addView(title);
    }
    private LinearLayout panel(String title,String value,int color) {
        LinearLayout p=column();p.setBackground(shape(color,16));
        p.setPadding(dp(15),dp(14),dp(15),dp(14));
        TextView a=label(title,12,Color.rgb(224,238,250),false);
        TextView b=label(value,24,Color.WHITE,true);
        p.addView(a);p.addView(b);
        LinearLayout.LayoutParams lp=new LinearLayout.LayoutParams(-1,-2);
        lp.bottomMargin=dp(9);content.addView(p,lp);
        return p;
    }
    private void section(String title) {
        TextView t=label(title,16,INK,true);
        t.setPadding(dp(4),dp(15),dp(4),dp(8));content.addView(t);
    }
    private void info(String text){
        TextView t=label(text,13,MUTED,false);t.setPadding(dp(7),dp(8),dp(7),dp(8));content.addView(t);
    }
    private void rowCard(String header,String detail,String amount,int amountColor,Runnable click) {
        LinearLayout wrap=line();wrap.setPadding(dp(12),dp(12),dp(12),dp(12));
        wrap.setBackground(shape(Color.WHITE,12));
        LinearLayout left=column();
        left.addView(label(header,14,INK,true));
        TextView sub=label(detail,11,MUTED,false);sub.setPadding(0,dp(3),0,0);
        left.addView(sub);wrap.addView(left,new LinearLayout.LayoutParams(0,-2,1));
        TextView right=label(amount,13,amountColor,true);
        right.setGravity(Gravity.RIGHT|Gravity.CENTER_VERTICAL);
        wrap.addView(right,new LinearLayout.LayoutParams(dp(119),-2));
        LinearLayout.LayoutParams lp=new LinearLayout.LayoutParams(-1,-2);
        lp.bottomMargin=dp(7);content.addView(wrap,lp);
        if(click!=null)wrap.setOnClickListener(v->click.run());
    }
    private void dashboard() {
        heading("Visão geral");
        JSONArray rows=list(data,"lancamentos");
        String now=today();
        Calendar c=Calendar.getInstance();c.add(Calendar.DATE,30);
        String next30=new SimpleDateFormat("yyyy-MM-dd",BR).format(c.getTime());
        double balance=0,receive=0,pay=0,in30=0,out30=0;
        List<JSONObject> due=new ArrayList<>();
        for(int i=0;i<rows.length();i++){
            JSONObject r=obj(rows,i);if(r==null||paidCard(r))continue;
            double amount=Math.abs(val(r,"valor"));
            String date=str(r,"data");
            if(settled(r)){
                if(date.compareTo(now)<=0)balance+=income(r)?amount:-amount;
            }else{
                if(date.compareTo(now)<=0){
                    if(income(r))receive+=amount;else pay+=amount;
                }else if(date.compareTo(next30)<=0){
                    if(income(r))in30+=amount;else out30+=amount;
                }
                due.add(r);
            }
        }
        panel("SALDO REAL • CONSOLIDADO",money(balance),PANEL);
        LinearLayout p=panel("PENDÊNCIAS ATÉ HOJE",money(receive)+"  /  "+money(pay),balance<0?RED:BLUE);
        p.addView(label("Receber / Pagar",11,Color.WHITE,false));
        panel("PRÓXIMOS 30 DIAS",money(in30)+"  /  "+money(out30),GREEN);
        info("Entradas / Saídas previstas. Pagamentos já feitos no cartão não descontam novamente do saldo.");
        section("Próximos vencimentos");
        Collections.sort(due,(a,b)->str(a,"data").compareTo(str(b,"data")));
        int shown=0;
        for(JSONObject r:due){
            if(shown++>=10)break;
            rowCard(str(r,"descricao"),niceDate(str(r,"data"))+"  ·  "+str(r,"status"),
                    (income(r)?"+ ":"− ")+money(Math.abs(val(r,"valor"))),
                    income(r)?GREEN:RED,()->transactionMenu(r));
        }
        if(due.isEmpty())info("Nenhum lançamento pendente.");
        Button newEntry=button("+ Novo lançamento",BLUE);
        content.addView(newEntry,new LinearLayout.LayoutParams(-1,dp(49)));
        newEntry.setOnClickListener(v->editTransaction(null));
    }
    private void transactions() {
        heading("Lançamentos");
        Button newEntry=button("+ Novo lançamento",BLUE);
        content.addView(newEntry,new LinearLayout.LayoutParams(-1,dp(46)));
        newEntry.setOnClickListener(v->editTransaction(null));
        search=new EditText(this);
        search.setTextSize(14);
        search.setSingleLine(true);
        search.setHint("Pesquisar descrição, categoria ou valor");
        search.setText(term);
        LinearLayout.LayoutParams sp=new LinearLayout.LayoutParams(-1,dp(53));
        sp.topMargin=dp(10);
        content.addView(search,sp);
        LinearLayout filters=line();
        for(String option:new String[]{"Todos","Receita","Despesa","Pendentes"}){
            TextView chip=label(option,12,mode.equals(option)?Color.WHITE:BLUE,mode.equals(option));
            chip.setGravity(Gravity.CENTER);
            chip.setBackground(shape(mode.equals(option)?BLUE:Color.rgb(229,238,247),10));
            LinearLayout.LayoutParams cp=new LinearLayout.LayoutParams(0,dp(37),1);
            cp.rightMargin=dp(4);filters.addView(chip,cp);
            chip.setOnClickListener(v->{term=search.getText().toString();mode=option;render();});
        }
        content.addView(filters);
        transactionsList=column();content.addView(transactionsList);
        search.addTextChangedListener(new TextWatcher(){
            public void beforeTextChanged(CharSequence s,int start,int count,int after){}
            public void onTextChanged(CharSequence s,int start,int before,int count){
                term=s.toString();populateTransactions();
            }
            public void afterTextChanged(Editable e){}
        });
        populateTransactions();
    }
    private void populateTransactions(){
        if(transactionsList==null)return;
        transactionsList.removeAllViews();
        JSONArray rows=list(data,"lancamentos");
        ArrayList<JSONObject> all=new ArrayList<>();
        String f=term.trim().toLowerCase(BR);
        for(int i=0;i<rows.length();i++){
            JSONObject r=obj(rows,i);if(r==null)continue;
            if(mode.equals("Receita")&&!income(r))continue;
            if(mode.equals("Despesa")&&income(r))continue;
            if(mode.equals("Pendentes")&&(settled(r)||paidCard(r)))continue;
            if(!f.isEmpty()&&!((str(r,"descricao")+" "+str(r,"categoria")+" "+money(val(r,"valor"))).toLowerCase(BR).contains(f)))continue;
            all.add(r);
        }
        Collections.sort(all,(a,b)->str(b,"data").compareTo(str(a,"data")));
        TextView count=label(all.size()+" lançamento(s) • toque para abrir",12,MUTED,false);
        count.setPadding(dp(4),dp(10),dp(4),dp(8));
        transactionsList.addView(count);
        int limit=Math.min(all.size(),180);
        for(int i=0;i<limit;i++){
            JSONObject r=all.get(i);
            LinearLayout item=line();item.setPadding(dp(12),dp(10),dp(12),dp(10));
            item.setBackground(shape(Color.WHITE,12));
            LinearLayout left=column();
            left.addView(label(str(r,"descricao"),14,INK,true));
            left.addView(label(niceDate(str(r,"data"))+"  ·  "+str(r,"categoria")+"  ·  "+str(r,"status"),11,MUTED,false));
            item.addView(left,new LinearLayout.LayoutParams(0,-2,1));
            item.addView(label((income(r)?"+ ":"− ")+money(Math.abs(val(r,"valor"))),12,income(r)?GREEN:RED,true));
            LinearLayout.LayoutParams lp=new LinearLayout.LayoutParams(-1,-2);
            lp.bottomMargin=dp(6);transactionsList.addView(item,lp);
            item.setOnClickListener(v->transactionMenu(r));
        }
        if(all.size()>limit){
            TextView more=label("Exibindo "+limit+" registros. Use a pesquisa para localizar outros.",12,MUTED,false);
            transactionsList.addView(more);
        }
    }
    private void transactionMenu(JSONObject r){
        final boolean canSettle=!settled(r)&&!paidCard(r);
        final ArrayList<String> names=new ArrayList<>();
        if(canSettle)names.add(income(r)?"Confirmar recebimento":"Confirmar pagamento");
        if(canSettle)names.add("Manter em aberto / adiar");
        if(canSettle&&!income(r))names.add("Pagar com cartão");
        names.add("Editar lançamento");
        names.add("Excluir lançamento");
        new AlertDialog.Builder(this)
                .setTitle(str(r,"descricao")+"\n"+money(val(r,"valor"))+" · "+niceDate(str(r,"data")))
                .setItems(names.toArray(new String[0]),(dialog,which)->{
                    String action=names.get(which);
                    if(action.startsWith("Confirmar"))confirm("Confirmar liquidação?",()->request("liquidarLancamentoBackend",r.opt("id"),true,null));
                    else if(action.startsWith("Manter"))postpone(r);
                    else if(action.startsWith("Pagar com"))payWithCard(r);
                    else if(action.startsWith("Editar"))editTransaction(r);
                    else confirm("Excluir definitivamente este lançamento?",()->{
                        JSONArray args=new JSONArray();args.put("Lancamentos");args.put(r.opt("id"));
                        request("excluirLinha",args,true,null);
                    });
                }).setNegativeButton("Fechar",null).show();
    }
    private void confirm(String question,Runnable yes) {
        new AlertDialog.Builder(this).setMessage(question).setNegativeButton("Cancelar",null)
                .setPositiveButton("Confirmar",(d,w)->yes.run()).show();
    }
    private LinearLayout form() {
        LinearLayout form=column();form.setPadding(dp(18),dp(6),dp(18),dp(4));return form;
    }
    private EditText input(LinearLayout form,String hint,String value,boolean number) {
        EditText e=new EditText(this);e.setSingleLine(true);e.setHint(hint);e.setText(value);
        e.setTextSize(15);e.setInputType(number?InputType.TYPE_CLASS_NUMBER|InputType.TYPE_NUMBER_FLAG_DECIMAL:
                InputType.TYPE_CLASS_TEXT|InputType.TYPE_TEXT_FLAG_CAP_SENTENCES);
        LinearLayout.LayoutParams lp=new LinearLayout.LayoutParams(-1,dp(54));form.addView(e,lp);
        return e;
    }
    private Spinner picker(LinearLayout form,String[] options,int selected) {
        Spinner s=new Spinner(this);
        ArrayAdapter<String> a=new ArrayAdapter<>(this,android.R.layout.simple_spinner_dropdown_item,options);
        s.setAdapter(a);s.setSelection(Math.max(0,Math.min(options.length-1,selected)));
        form.addView(s,new LinearLayout.LayoutParams(-1,dp(52)));return s;
    }
    private int findOption(String[] options,String value) {
        for(int i=0;i<options.length;i++)if(options[i].equalsIgnoreCase(value))return i;
        return 0;
    }
    private String[] categories(){
        JSONArray cats=list(data,"categorias");
        ArrayList<String> values=new ArrayList<>();values.add("Sem Categoria");
        for(int i=0;i<cats.length();i++){
            JSONObject c=obj(cats,i);if(c!=null&&!values.contains(str(c,"nome")))values.add(str(c,"nome"));
        }
        return values.toArray(new String[0]);
    }
    private void dateField(EditText edit){
        edit.setInputType(InputType.TYPE_CLASS_DATETIME|InputType.TYPE_DATETIME_VARIATION_DATE);
        edit.setFocusable(false);
        edit.setOnClickListener(v->{
            Calendar cal=Calendar.getInstance();
            try {
                Date date=new SimpleDateFormat("yyyy-MM-dd",BR).parse(edit.getText().toString());
                if(date!=null)cal.setTime(date);
            }catch(Exception ignored){}
            new DatePickerDialog(this,(picker,year,month,day)->
                    edit.setText(String.format(BR,"%04d-%02d-%02d",year,month+1,day)),
                    cal.get(Calendar.YEAR),cal.get(Calendar.MONTH),cal.get(Calendar.DAY_OF_MONTH)).show();
        });
    }
    private void editTransaction(JSONObject current){
        boolean editing=current!=null;
        LinearLayout fields=form();
        EditText desc=input(fields,"Descrição",editing?str(current,"descricao"):"",false);
        EditText value=input(fields,"Valor",editing?String.format(BR,"%.2f",val(current,"valor")):"",true);
        Spinner type=picker(fields,new String[]{"Despesa","Receita"},editing&&income(current)?1:0);
        String[] cats=categories();
        Spinner cat=picker(fields,cats,editing?findOption(cats,str(current,"categoria")):0);
        EditText date=input(fields,"Vencimento (AAAA-MM-DD)",editing?str(current,"data"):today(),false);dateField(date);
        new AlertDialog.Builder(this).setTitle(editing?"Editar lançamento":"Novo lançamento")
                .setView(fields).setNegativeButton("Cancelar",null)
                .setPositiveButton("Salvar",(d,w)->{
                    try{
                        double amount=parseAmount(value.getText().toString());
                        if(amount<=0||desc.getText().toString().trim().isEmpty())throw new Exception("Informe descrição e valor maior que zero.");
                        JSONObject record=new JSONObject();
                        record.put("descricao",desc.getText().toString().trim());
                        record.put("valor",amount);
                        record.put("tipo",type.getSelectedItem().toString());
                        record.put("categoria",cat.getSelectedItem().toString());
                        record.put("data",date.getText().toString());
                        if(editing){
                            record.put("id",current.opt("id"));
                            if(!str(current,"recorrenciaId").isEmpty()){
                                record.put("recorrenciaId",str(current,"recorrenciaId"));
                                record.put("dataOriginalCorte",str(current,"data"));
                                JSONArray args=new JSONArray();args.put(record);args.put("unico");
                                request("atualizarLancamentoAvancado",args,true,null);
                            }else request("atualizarLancamentoBackend",record,true,null);
                        }else request("salvarLancamentoManual",record,true,null);
                    }catch(Exception e){error(e.getMessage());}
                }).show();
    }
    private void postpone(JSONObject r) {
        LinearLayout fields=form();
        EditText date=input(fields,"Nova data (opcional)",str(r,"data"),false);dateField(date);
        new AlertDialog.Builder(this).setTitle("Manter em aberto")
                .setMessage("A dívida permanece pendente. Ajuste o vencimento ou mantenha a data.")
                .setView(fields).setNegativeButton("Cancelar",null)
                .setPositiveButton("Salvar",(d,w)->{
                    JSONArray args=new JSONArray();args.put(r.opt("id"));args.put(date.getText().toString());
                    request("marcarEmAbertoBackend",args,true,null);
                }).show();
    }
    private void loadBank() {
        statusText.setText("Buscando banco…");
        request("obterConciliacaoBancoV59",null,false,response->{
            if(response instanceof JSONObject){bank=(JSONObject)response;render();}
            else error("A API bancária devolveu um formato inesperado.");
        });
    }
    private void loadCards() {
        statusText.setText("Buscando cartões…");
        request("obterCartaoCreditoV513",null,false,response->{
            if(response instanceof JSONObject){cards=(JSONObject)response;render();}
            else error("A API de cartões devolveu um formato inesperado.");
        });
    }
    private void showBank() {
        heading("Banco / Pluggy");
        Button reload=button("Atualizar movimentos",BLUE);
        content.addView(reload,new LinearLayout.LayoutParams(-1,dp(45)));
        reload.setOnClickListener(v->loadBank());
        if(bank==null){info("Buscando movimentações do banco…");return;}
        JSONObject health=bank.optJSONObject("saudeSaldo");
        JSONArray movements=list(bank,"movimentos");
        panel("MOVIMENTOS NÃO CONCILIADOS",String.valueOf(movements.length()),PANEL);
        info("Toque para conciliar, criar lançamento ou ignorar. Operações só são gravadas após confirmação.");
        for(int i=0;i<Math.min(movements.length(),100);i++) {
            JSONObject m=obj(movements,i);if(m==null)continue;
            rowCard(str(m,"descricao"),niceDate(str(m,"data"))+"  ·  "+str(m,"conta"),
                    money(val(m,"valor")),val(m,"valor")<0?RED:GREEN,()->bankMenu(m));
        }
        if(movements.length()==0)info("Nenhum movimento novo a conciliar.");
    }
    private void bankMenu(JSONObject m){
        String[] options={"Conciliar com lançamento","Criar lançamento e conciliar","Ignorar movimento"};
        new AlertDialog.Builder(this).setTitle(str(m,"descricao")+"\n"+money(val(m,"valor")))
                .setItems(options,(d,which)->{
                    if(which==0)matchBank(m);
                    else if(which==1)createFromBank(m);
                    else confirm("Ignorar este movimento bancário?",()->
                        request("ignorarMovimentoBancoV510",str(m,"idPluggy"),true,r->loadBank()));
                }).setNegativeButton("Cancelar",null).show();
    }
    private void matchBank(JSONObject movement){
        request("obterLancamentosDisponiveisConciliacaoV601",null,false,response->{
            if(!(response instanceof JSONArray)){error("Não foi possível carregar lançamentos elegíveis.");return;}
            JSONArray rows=(JSONArray)response;
            List<JSONObject> eligible=new ArrayList<>();
            boolean isIncome=val(movement,"valor")>0;
            for(int i=0;i<rows.length();i++){
                JSONObject r=obj(rows,i);
                if(r!=null&&income(r)==isIncome)eligible.add(r);
            }
            Collections.sort(eligible,(a,b)->{
                double da=Math.abs(val(a,"valor")-Math.abs(val(movement,"valor")));
                double db=Math.abs(val(b,"valor")-Math.abs(val(movement,"valor")));
                return Double.compare(da,db);
            });
            if(eligible.isEmpty()){error("Nenhum lançamento elegível do mesmo tipo.");return;}
            int count=Math.min(eligible.size(),100);
            String[] choices=new String[count];
            for(int i=0;i<count;i++){
                JSONObject r=eligible.get(i);
                choices[i]=niceDate(str(r,"data"))+" · "+str(r,"descricao")+" · "+money(val(r,"valor"));
            }
            new AlertDialog.Builder(this).setTitle("Selecione lançamento para conciliar")
                .setItems(choices,(d,which)->{
                    JSONObject r=eligible.get(which);
                    confirm("Conciliar "+str(movement,"descricao")+" com "+str(r,"descricao")+"?",()->{
                        try{
                            JSONObject req=new JSONObject();
                            req.put("idPluggy",str(movement,"idPluggy"));
                            req.put("idLancamento",r.opt("id"));
                            request("conciliarMovimentoBancoV510",req,true,v->loadBank());
                        }catch(Exception e){error(e.getMessage());}
                    });
                }).setNegativeButton("Cancelar",null).show();
        });
    }
    private void createFromBank(JSONObject m){
        LinearLayout fields=form();
        EditText desc=input(fields,"Descrição",str(m,"descricao"),false);
        String[] cats=categories();Spinner category=picker(fields,cats,0);
        new AlertDialog.Builder(this).setTitle("Novo lançamento do banco").setView(fields)
            .setNegativeButton("Cancelar",null)
            .setPositiveButton("Criar e conciliar",(d,w)->{
                if(desc.getText().toString().trim().isEmpty()){error("Informe descrição.");return;}
                try{
                    JSONObject req=new JSONObject();
                    req.put("idPluggy",str(m,"idPluggy"));
                    req.put("descricao",desc.getText().toString().trim());
                    req.put("categoria",category.getSelectedItem().toString());
                    request("criarLancamentoBancoV510",req,true,r->loadBank());
                }catch(Exception e){error(e.getMessage());}
            }).show();
    }
    private void showCards(){
        heading("Cartões de crédito");
        Button reload=button("Atualizar cartões",BLUE);
        content.addView(reload,new LinearLayout.LayoutParams(-1,dp(45)));
        reload.setOnClickListener(v->loadCards());
        if(cards==null){info("Buscando cartões vinculados ao Pluggy…");return;}
        JSONObject totals=cards.optJSONObject("resumo");
        panel("FATURA ATUAL",money(val(totals,"faturaAtual")),PANEL);
        panel("LIMITE DISPONÍVEL",money(val(totals,"limiteDisponivel")),BLUE);
        JSONArray arr=list(cards,"cartoes");
        section("Seus cartões");
        for(int i=0;i<arr.length();i++){
            JSONObject c=obj(arr,i);if(c==null)continue;
            rowCard(str(c,"nome")+" •••• "+str(c,"final"),"Vence "+niceDate(str(c,"vencimento")),
                    money(val(c,"saldoFatura")),RED,null);
        }
        section("Movimentações");
        JSONArray mov=list(cards,"movimentos");
        for(int i=0;i<Math.min(80,mov.length());i++){
            JSONObject c=obj(mov,i);if(c==null)continue;
            rowCard(str(c,"descricao"),niceDate(str(c,"data"))+" · "+str(c,"cartao"),
                    money(Math.abs(val(c,"valor"))),INK,null);
        }
    }
    private void payWithCard(JSONObject r){
        if(cards==null){
            request("obterCartaoCreditoV513",null,false,response->{
                if(response instanceof JSONObject){cards=(JSONObject)response;payWithCard(r);}
                else error("Cartões indisponíveis.");
            });
            return;
        }
        JSONArray c=list(cards,"cartoes");
        if(c.length()==0){error("Nenhum cartão sincronizado com o Pluggy.");return;}
        String[] choices=new String[c.length()];
        for(int i=0;i<c.length();i++){
            JSONObject card=obj(c,i);choices[i]=str(card,"nome")+" · "+str(card,"final");
        }
        new AlertDialog.Builder(this).setTitle("Selecione o cartão")
            .setItems(choices,(d,which)->{
                JSONObject card=obj(c,which);
                LinearLayout fields=form();EditText installments=input(fields,"Parcelas","1",true);
                new AlertDialog.Builder(this).setTitle("Pagar no cartão "+str(card,"nome"))
                    .setMessage("Não descontar do saldo bancário agora; o débito ocorrerá na fatura.")
                    .setView(fields).setNegativeButton("Cancelar",null)
                    .setPositiveButton("Confirmar",(dialog,index)->{
                        try{
                            JSONObject req=new JSONObject();
                            req.put("idLancamento",r.opt("id"));
                            req.put("accountId",str(card,"accountId"));
                            req.put("cartao",str(card,"nome"));
                            req.put("parcelas",Math.max(1,Integer.parseInt(installments.getText().toString().trim())));
                            req.put("dataPagamento",today());
                            request("pagarLancamentoComCartaoV516",req,true,null);
                        }catch(Exception e){error(e.getMessage());}
                    }).show();
            }).setNegativeButton("Cancelar",null).show();
    }
    private void showRecurring(){
        heading("Contas recorrentes");
        Button newRec=button("+ Nova recorrência",BLUE);
        content.addView(newRec,new LinearLayout.LayoutParams(-1,dp(46)));
        newRec.setOnClickListener(v->newRecurring());
        JSONArray arr=list(data,"recorrenciasConfig");
        section("Cadastros existentes");
        for(int i=0;i<arr.length();i++){
            JSONObject rec=obj(arr,i);if(rec==null)continue;
            rowCard(str(rec,"descricao"),str(rec,"frequencia")+" · desde "+niceDate(str(rec,"dataInicio")),
                    money(val(rec,"valor")),income(rec)?GREEN:RED,null);
        }
        if(arr.length()==0)info("Sem recorrências cadastradas.");
    }
    private void newRecurring(){
        LinearLayout form=form();
        EditText desc=input(form,"Descrição","",false);
        EditText amount=input(form,"Valor","",true);
        Spinner type=picker(form,new String[]{"Despesa","Receita"},0);
        String[] cats=categories();Spinner category=picker(form,cats,0);
        Spinner frequency=picker(form,new String[]{"Mensal","Semanal"},0);
        EditText day=input(form,"Dia alvo (mês 1–31, semana 1–7)","5",true);
        EditText date=input(form,"Data de início",today(),false);dateField(date);
        new AlertDialog.Builder(this).setTitle("Nova recorrência").setView(form)
                .setNegativeButton("Cancelar",null)
                .setPositiveButton("Salvar",(d,w)->{
                    try{
                        double value=parseAmount(amount.getText().toString());
                        int dayTarget=Integer.parseInt(day.getText().toString());
                        boolean monthly=frequency.getSelectedItem().toString().equals("Mensal");
                        if(desc.getText().toString().trim().isEmpty()||value<=0||
                            dayTarget<1||dayTarget>(monthly?31:7))throw new Exception("Confira descrição, valor e dia alvo.");
                        JSONObject req=new JSONObject();
                        req.put("descricao",desc.getText().toString().trim());req.put("valor",value);
                        req.put("tipo",type.getSelectedItem().toString());
                        req.put("categoria",category.getSelectedItem().toString());
                        req.put("frequencia",frequency.getSelectedItem().toString());
                        req.put("diaAlvo",dayTarget);req.put("dataInicio",date.getText().toString());
                        req.put("tipoTermino","nunca");req.put("valorTermino","");
                        request("salvarContasRecorrentesMaster",req,true,null);
                    }catch(Exception e){error(e.getMessage());}
                }).show();
    }
}
