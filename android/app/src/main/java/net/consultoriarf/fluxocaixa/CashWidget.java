package net.consultoriarf.fluxocaixa;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.Intent;

public final class CashWidget extends AppWidgetProvider {
    public static final String ACTION_REFRESH = "net.consultoriarf.fluxocaixa.REFRESH";

    @Override
    public void onEnabled(Context context) {
        super.onEnabled(context);
        RefreshService.schedule(context);
    }

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] ids) {
        super.onUpdate(context, manager, ids);
        RefreshService.schedule(context);
        CashRepository.showCached(context);
        updateAsync(context);
    }

    @Override
    public void onReceive(Context context, Intent intent) {
        super.onReceive(context, intent);
        if (ACTION_REFRESH.equals(intent.getAction())) updateAsync(context);
    }

    private void updateAsync(Context context) {
        PendingResult pending = goAsync();
        Context app = context.getApplicationContext();
        new Thread(() -> {
            try {
                CashRepository.refresh(app);
            } finally {
                pending.finish();
            }
        }, "rf-cash-widget").start();
    }
}
