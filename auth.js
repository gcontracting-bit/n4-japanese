(function() {
    // Simple client-side password protection for personal study dashboard.
    // Change this hash to update the password. Current password: n4study2026
    var PASS_HASH = '6e347374756479323032362d6e346a6170616e657365';

    function simpleHash(str) {
        return str.split('').map(function(c) {
            return c.charCodeAt(0).toString(16);
        }).join('');
    }

    function isAuthenticated() {
        return sessionStorage.getItem('n4auth') === 'yes';
    }

    function authenticate(password) {
        if (simpleHash(password + '-n4japanese') === PASS_HASH) {
            sessionStorage.setItem('n4auth', 'yes');
            return true;
        }
        return false;
    }

    if (isAuthenticated()) return;

    // Hide page content and show login
    document.documentElement.style.visibility = 'hidden';

    document.addEventListener('DOMContentLoaded', function() {
        document.documentElement.style.visibility = 'hidden';

        var overlay = document.createElement('div');
        overlay.id = 'auth-overlay';
        overlay.innerHTML =
            '<div style="position:fixed;top:0;left:0;width:100%;height:100%;background:#f0f2f5;display:flex;align-items:center;justify-content:center;z-index:99999;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;">' +
                '<div style="background:#fff;border-radius:16px;padding:40px;box-shadow:0 4px 24px rgba(0,0,0,0.1);text-align:center;max-width:360px;width:90%;">' +
                    '<div style="font-size:2.5em;margin-bottom:12px;">🇯🇵</div>' +
                    '<h1 style="margin:0 0 8px;font-size:1.4em;color:#1a1a2e;">N4 Japanese</h1>' +
                    '<p style="margin:0 0 24px;color:#666;font-size:0.9em;">Enter password to continue</p>' +
                    '<input type="password" id="auth-pass" placeholder="Password" ' +
                        'style="width:100%;padding:12px 16px;border:2px solid #e0e0e0;border-radius:8px;font-size:1em;box-sizing:border-box;outline:none;transition:border-color 0.2s;" ' +
                        'onfocus="this.style.borderColor=\'#4a90d9\'" onblur="this.style.borderColor=\'#e0e0e0\'">' +
                    '<button id="auth-btn" style="width:100%;padding:12px;margin-top:12px;background:#2f855a;color:#fff;border:none;border-radius:8px;font-size:1em;cursor:pointer;font-weight:600;">Enter</button>' +
                    '<p id="auth-error" style="color:#c0392b;margin:12px 0 0;font-size:0.85em;display:none;">Incorrect password</p>' +
                '</div>' +
            '</div>';

        document.body.appendChild(overlay);
        document.documentElement.style.visibility = 'visible';

        var passInput = document.getElementById('auth-pass');
        var btn = document.getElementById('auth-btn');
        var error = document.getElementById('auth-error');

        function tryLogin() {
            if (authenticate(passInput.value)) {
                overlay.remove();
                location.reload();
            } else {
                error.style.display = 'block';
                passInput.style.borderColor = '#c0392b';
                passInput.value = '';
                passInput.focus();
            }
        }

        btn.addEventListener('click', tryLogin);
        passInput.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') tryLogin();
        });

        passInput.focus();
    });
})();
