/**
 * 云存储Web UI
 * 提供登录、注册、文件管理和管理员面板的HTML界面
 */

import { ServerResponse } from 'http';

/**
 * 生成登录/注册页面
 */
function getLoginPage(): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Lumino 云存储 - 登录</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { 
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        .container {
            background: white;
            padding: 40px;
            border-radius: 12px;
            box-shadow: 0 10px 40px rgba(0,0,0,0.2);
            width: 400px;
            max-width: 90%;
        }
        h1 { 
            text-align: center; 
            margin-bottom: 10px; 
            color: #333;
            font-size: 1.8em;
        }
        .subtitle {
            text-align: center;
            color: #666;
            margin-bottom: 30px;
            font-size: 0.9em;
        }
        .form-group {
            margin-bottom: 20px;
        }
        label {
            display: block;
            margin-bottom: 8px;
            color: #555;
            font-weight: 500;
        }
        input[type="text"], input[type="password"] {
            width: 100%;
            padding: 12px 16px;
            border: 2px solid #e1e1e1;
            border-radius: 8px;
            font-size: 1em;
            transition: border-color 0.3s;
        }
        input:focus {
            outline: none;
            border-color: #667eea;
        }
        .btn {
            width: 100%;
            padding: 14px;
            border: none;
            border-radius: 8px;
            font-size: 1em;
            font-weight: 600;
            cursor: pointer;
            transition: transform 0.2s, box-shadow 0.2s;
        }
        .btn-primary {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
        }
        .btn-primary:hover {
            transform: translateY(-2px);
            box-shadow: 0 5px 20px rgba(102, 126, 234, 0.4);
        }
        .btn-secondary {
            background: #f0f0f0;
            color: #333;
            margin-top: 10px;
        }
        .btn-secondary:hover { background: #e0e0e0; }
        .error {
            background: #fee2e2;
            color: #dc2626;
            padding: 12px;
            border-radius: 8px;
            margin-bottom: 20px;
            display: none;
        }
        .success {
            background: #d1fae5;
            color: #059669;
            padding: 12px;
            border-radius: 8px;
            margin-bottom: 20px;
            display: none;
        }
        .tabs {
            display: flex;
            margin-bottom: 30px;
            border-bottom: 2px solid #e1e1e1;
        }
        .tab {
            flex: 1;
            padding: 12px;
            text-align: center;
            cursor: pointer;
            border-bottom: 2px solid transparent;
            margin-bottom: -2px;
            transition: all 0.3s;
            color: #666;
            font-weight: 500;
        }
        .tab.active {
            color: #667eea;
            border-bottom-color: #667eea;
        }
        .tab:hover { color: #667eea; }
        .form { display: none; }
        .form.active { display: block; }
        .password-hint {
            font-size: 0.85em;
            color: #888;
            margin-top: 5px;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>💾 Lumino 云存储</h1>
        <p class="subtitle">安全的工程备份解决方案</p>
        
        <div class="tabs">
            <div class="tab active" onclick="switchTab('login')">登录</div>
            <div class="tab" onclick="switchTab('register')">注册</div>
        </div>
        
        <div id="error" class="error"></div>
        <div id="success" class="success"></div>
        
        <!-- 登录表单 -->
        <div id="login-form" class="form active">
            <div class="form-group">
                <label>用户名</label>
                <input type="text" id="login-username" placeholder="请输入用户名">
            </div>
            <div class="form-group">
                <label>密码</label>
                <input type="password" id="login-password" placeholder="请输入密码">
            </div>
            <button class="btn btn-primary" onclick="login()">登录</button>
        </div>
        
        <!-- 注册表单 -->
        <div id="register-form" class="form">
            <div class="form-group">
                <label>用户名</label>
                <input type="text" id="register-username" placeholder="至少3个字符">
            </div>
            <div class="form-group">
                <label>密码</label>
                <input type="password" id="register-password" placeholder="至少6个字符">
                <p class="password-hint">建议使用字母、数字和特殊字符的组合</p>
            </div>
            <div class="form-group">
                <label>确认密码</label>
                <input type="password" id="register-confirm" placeholder="再次输入密码">
            </div>
            <button class="btn btn-primary" onclick="register()">注册</button>
        </div>
    </div>

    <script>
        const token = localStorage.getItem('token');
        if (token) {
            // 已登录，检查会话是否有效
            fetch('/api/auth/me', {
                headers: { 'Authorization': 'Bearer ' + token }
            })
            .then(res => res.json())
            .then(data => {
                if (data.success) {
                    window.location.href = '/cloud';
                }
            })
            .catch(() => {});
        }

        function switchTab(tab) {
            document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.form').forEach(f => f.classList.remove('active'));
            
            if (tab === 'login') {
                document.querySelector('.tab:first-child').classList.add('active');
                document.getElementById('login-form').classList.add('active');
            } else {
                document.querySelector('.tab:last-child').classList.add('active');
                document.getElementById('register-form').classList.add('active');
            }
            hideMessages();
        }

        function showError(msg) {
            const el = document.getElementById('error');
            el.textContent = msg;
            el.style.display = 'block';
            document.getElementById('success').style.display = 'none';
        }

        function showSuccess(msg) {
            const el = document.getElementById('success');
            el.textContent = msg;
            el.style.display = 'block';
            document.getElementById('error').style.display = 'none';
        }

        function hideMessages() {
            document.getElementById('error').style.display = 'none';
            document.getElementById('success').style.display = 'none';
        }

        async function login() {
            const username = document.getElementById('login-username').value.trim();
            const password = document.getElementById('login-password').value;

            if (!username || !password) {
                showError('请输入用户名和密码');
                return;
            }

            try {
                const res = await fetch('/api/auth/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username, password })
                });

                const data = await res.json();
                
                if (data.success) {
                    localStorage.setItem('token', data.token);
                    localStorage.setItem('username', data.username);
                    localStorage.setItem('isAdmin', data.isAdmin);
                    localStorage.setItem('mustResetPwd', data.mustResetPwd);
                    
                    if (data.mustResetPwd) {
                        window.location.href = '/cloud?reset=true';
                    } else {
                        window.location.href = '/cloud';
                    }
                } else {
                    showError(data.error || '登录失败');
                }
            } catch (error) {
                showError('网络错误，请稍后重试');
            }
        }

        async function register() {
            const username = document.getElementById('register-username').value.trim();
            const password = document.getElementById('register-password').value;
            const confirm = document.getElementById('register-confirm').value;

            if (!username || !password) {
                showError('请填写所有字段');
                return;
            }

            if (password !== confirm) {
                showError('两次输入的密码不一致');
                return;
            }

            try {
                const res = await fetch('/api/auth/register', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username, password })
                });

                const data = await res.json();
                
                if (data.success) {
                    localStorage.setItem('token', data.token);
                    localStorage.setItem('username', data.username);
                    localStorage.setItem('isAdmin', data.isAdmin);
                    window.location.href = '/cloud';
                } else {
                    showError(data.error || '注册失败');
                }
            } catch (error) {
                showError('网络错误，请稍后重试');
            }
        }

        // Enter键提交
        document.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                const loginForm = document.getElementById('login-form');
                if (loginForm.classList.contains('active')) {
                    login();
                } else {
                    register();
                }
            }
        });
    </script>
</body>
</html>`;
}

/**
 * 生成主界面
 */
function getMainPage(): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Lumino 云存储 - 文件管理</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { 
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            background: #f5f5f5;
            min-height: 100vh;
        }
        /* 未登录时隐藏所有内容 */
        body[data-auth="false"] .app-wrapper { display: none; }
        body[data-auth="false"] .auth-loading { display: flex; }
        body[data-auth="true"] .auth-loading { display: none; }
        
        .auth-loading {
            display: flex;
            align-items: center;
            justify-content: center;
            min-height: 100vh;
            flex-direction: column;
            gap: 16px;
            color: #666;
        }
        .auth-loading .spinner {
            width: 40px; height: 40px;
            border: 4px solid #e5e5e5;
            border-top-color: #667eea;
            border-radius: 50%;
            animation: spin 0.8s linear infinite;
        }
        @keyframes spin { to { transform: rotate(360deg); } }
        
        /* 顶栏 */
        .header {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 16px 24px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }
        .header h1 { font-size: 1.4em; }
        .header-right { display: flex; align-items: center; gap: 16px; }
        .user-info { font-size: 0.9em; }
        .badge {
            background: rgba(255,255,255,0.2);
            padding: 4px 10px;
            border-radius: 20px;
            font-size: 0.8em;
        }
        .badge-admin { background: #f59e0b; }
        .btn-logout {
            background: rgba(255,255,255,0.2);
            border: none;
            color: white;
            padding: 8px 16px;
            border-radius: 6px;
            cursor: pointer;
            font-size: 0.9em;
        }
        .btn-logout:hover { background: rgba(255,255,255,0.3); }
        
        /* 导航 */
        .nav {
            background: white;
            padding: 0 24px;
            border-bottom: 1px solid #e5e5e5;
            display: flex;
            gap: 0;
        }
        .nav-item {
            padding: 12px 20px;
            cursor: pointer;
            border-bottom: 2px solid transparent;
            color: #666;
            font-weight: 500;
            transition: all 0.3s;
        }
        .nav-item:hover { color: #667eea; }
        .nav-item.active {
            color: #667eea;
            border-bottom-color: #667eea;
        }
        
        /* 主内容 */
        .main { padding: 24px; max-width: 1200px; margin: 0 auto; }
        .panel { display: none; }
        .panel.active { display: block; }
        
        /* 文件管理 */
        .upload-area {
            background: white;
            border: 2px dashed #d1d5db;
            border-radius: 12px;
            padding: 40px;
            text-align: center;
            margin-bottom: 24px;
            cursor: pointer;
            transition: all 0.3s;
        }
        .upload-area:hover {
            border-color: #667eea;
            background: #f0f0ff;
        }
        .upload-area.dragover {
            border-color: #667eea;
            background: #e8e8ff;
        }
        .upload-area h3 { color: #333; margin-bottom: 8px; }
        .upload-area p { color: #888; font-size: 0.9em; }
        
        .file-list { background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 2px 10px rgba(0,0,0,0.05); }
        .file-header {
            display: grid;
            grid-template-columns: 1fr 120px 150px 120px;
            padding: 16px 20px;
            background: #f8f9fa;
            font-weight: 600;
            color: #555;
            font-size: 0.9em;
            border-bottom: 1px solid #e5e5e5;
        }
        .file-row {
            display: grid;
            grid-template-columns: 1fr 120px 150px 120px;
            padding: 14px 20px;
            border-bottom: 1px solid #f0f0f0;
            align-items: center;
            transition: background 0.2s;
        }
        .file-row:hover { background: #f8f9fa; }
        .file-name { 
            display: flex; 
            align-items: center; 
            gap: 10px; 
            font-weight: 500;
            color: #333;
        }
        .file-icon { font-size: 1.2em; }
        .file-size { color: #666; }
        .file-date { color: #888; font-size: 0.9em; }
        .file-actions { display: flex; gap: 8px; }
        
        .btn {
            padding: 6px 14px;
            border: none;
            border-radius: 6px;
            cursor: pointer;
            font-size: 0.85em;
            font-weight: 500;
            transition: all 0.2s;
        }
        .btn-download { background: #dbeafe; color: #2563eb; }
        .btn-download:hover { background: #bfdbfe; }
        .btn-delete { background: #fee2e2; color: #dc2626; }
        .btn-delete:hover { background: #fecaca; }
        .btn-primary { background: #667eea; color: white; }
        .btn-primary:hover { background: #5a67d8; }
        
        .empty-state {
            text-align: center;
            padding: 60px 20px;
            color: #888;
        }
        .empty-state h3 { color: #555; margin-bottom: 10px; }
        
        /* 存储使用情况 */
        .storage-info {
            background: white;
            padding: 20px;
            border-radius: 12px;
            margin-bottom: 24px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.05);
        }
        .storage-bar {
            height: 10px;
            background: #e5e5e5;
            border-radius: 5px;
            overflow: hidden;
            margin: 10px 0;
        }
        .storage-fill {
            height: 100%;
            background: linear-gradient(90deg, #667eea, #764ba2);
            border-radius: 5px;
            transition: width 0.3s;
        }
        .storage-text {
            display: flex;
            justify-content: space-between;
            font-size: 0.9em;
            color: #666;
        }
        
        /* 管理面板 */
        .admin-panel { display: none; }
        .admin-panel.active { display: block; }
        
        .user-card {
            background: white;
            padding: 20px;
            border-radius: 12px;
            margin-bottom: 16px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.05);
            display: grid;
            grid-template-columns: 1fr 150px 200px;
            gap: 20px;
            align-items: center;
        }
        .user-info-card h4 { color: #333; margin-bottom: 5px; }
        .user-info-card p { color: #888; font-size: 0.9em; }
        .user-quota {
            background: #f0f0f0;
            padding: 10px;
            border-radius: 8px;
            text-align: center;
        }
        .user-quota input {
            width: 80px;
            padding: 4px;
            border: 1px solid #ddd;
            border-radius: 4px;
            text-align: center;
        }
        .user-actions { display: flex; gap: 8px; flex-wrap: wrap; }
        
        /* 修改密码对话框 */
        .modal {
            display: none;
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0,0,0,0.5);
            align-items: center;
            justify-content: center;
            z-index: 1000;
        }
        .modal.active { display: flex; }
        .modal-content {
            background: white;
            padding: 30px;
            border-radius: 12px;
            width: 400px;
            max-width: 90%;
        }
        .modal h3 { margin-bottom: 20px; color: #333; }
        .modal input {
            width: 100%;
            padding: 10px;
            border: 2px solid #e5e5e5;
            border-radius: 6px;
            margin-bottom: 15px;
            font-size: 1em;
        }
        .modal input:focus { border-color: #667eea; outline: none; }
        .modal-btns { display: flex; gap: 10px; justify-content: flex-end; }
        
        .message {
            padding: 12px;
            border-radius: 8px;
            margin-bottom: 20px;
            display: none;
        }
        .message.success { background: #d1fae5; color: #059669; }
        .message.error { background: #fee2e2; color: #dc2626; }
        
        /* 上传进度 */
        .upload-progress {
            background: #e0e7ff;
            padding: 10px 20px;
            border-radius: 8px;
            margin-bottom: 16px;
            display: none;
        }
        .progress-bar {
            height: 6px;
            background: #c7d2fe;
            border-radius: 3px;
            overflow: hidden;
            margin-top: 8px;
        }
        .progress-fill {
            height: 100%;
            background: #667eea;
            width: 0%;
            transition: width 0.3s;
        }
    </style>
</head>
<body data-auth="false">
    <!-- 认证检查中 -->
    <div class="auth-loading">
        <div class="spinner"></div>
        <span>正在验证身份...</span>
    </div>

    <div class="app-wrapper">
    <!-- 顶栏 -->
    <div class="header">
        <h1>💾 Lumino 云存储</h1>
        <div class="header-right">
            <span class="user-info" id="user-info"></span>
            <span class="badge" id="admin-badge" style="display:none">管理员</span>
            <button class="btn-logout" onclick="logout()">退出</button>
        </div>
    </div>

    <!-- 导航 -->
    <div class="nav">
        <div class="nav-item active" onclick="switchPanel('files')">📁 我的文件</div>
        <div class="nav-item" id="nav-admin" style="display:none" onclick="switchPanel('admin')">👥 用户管理</div>
    </div>

    <!-- 主内容 -->
    <div class="main">
        <div id="message" class="message"></div>
        
        <!-- 文件管理面板 -->
        <div id="panel-files" class="panel active">
            <!-- 修改密码提示 -->
            <div id="reset-pwd-banner" style="display:none; background: #fef3c7; padding: 15px; border-radius: 8px; margin-bottom: 20px; border-left: 4px solid #f59e0b;">
                <strong>⚠️ 您需要修改密码</strong>
                <p style="font-size: 0.9em; margin: 5px 0 0;">管理员要求您在首次登录后修改密码</p>
                <button class="btn btn-primary" style="margin-top: 10px;" onclick="showChangePassword()">修改密码</button>
            </div>
            
            <!-- 存储信息 -->
            <div class="storage-info">
                <div class="storage-text">
                    <span>存储空间使用情况</span>
                    <span id="storage-usage">加载中...</span>
                </div>
                <div class="storage-bar">
                    <div class="storage-fill" id="storage-bar-fill" style="width: 0%"></div>
                </div>
                <div class="storage-text">
                    <span id="storage-used">已使用: --</span>
                    <span id="storage-total">配额: --</span>
                </div>
            </div>
            
            <!-- 上传区域 -->
            <div class="upload-area" id="upload-area">
                <h3>📤 上传文件</h3>
                <p>拖拽文件到此处，或点击选择文件</p>
                <input type="file" id="file-input" style="display: none;" multiple>
            </div>
            
            <div class="upload-progress" id="upload-progress">
                <span id="upload-status">上传中...</span>
                <div class="progress-bar">
                    <div class="progress-fill" id="upload-progress-fill"></div>
                </div>
            </div>
            
            <!-- 文件列表 -->
            <div class="file-list">
                <div class="file-header">
                    <span>文件名</span>
                    <span>大小</span>
                    <span>上传时间</span>
                    <span>操作</span>
                </div>
                <div id="file-list-body">
                    <div class="empty-state">
                        <h3>暂无文件</h3>
                        <p>上传您的第一个文件开始备份</p>
                    </div>
                </div>
            </div>
        </div>

        <!-- 管理员面板 -->
        <div id="panel-admin" class="panel">
            <h2 style="margin-bottom: 20px; color: #333;">👥 用户管理</h2>
            <div id="user-list">
                <div class="empty-state">
                    <h3>加载中...</h3>
                </div>
            </div>
        </div>
    </div>

    <!-- 修改密码对话框 -->
    <div class="modal" id="change-password-modal">
        <div class="modal-content">
            <h3>修改密码</h3>
            <input type="password" id="old-password" placeholder="当前密码">
            <input type="password" id="new-password" placeholder="新密码 (至少6位)">
            <input type="password" id="confirm-password" placeholder="确认新密码">
            <div class="modal-btns">
                <button class="btn" style="background: #e5e5e5;" onclick="closeModal('change-password-modal')">取消</button>
                <button class="btn btn-primary" onclick="changePassword()">确认修改</button>
            </div>
        </div>
    </div>

    <script>
        let token = localStorage.getItem('token');
        let isAdmin = localStorage.getItem('isAdmin') === 'true';
        let currentUserId = '';

        // 初始化
        (async function init() {
            if (!token) {
                window.location.href = '/cloud/login';
                return;
            }

            // 验证会话
            try {
                const res = await fetch('/api/auth/me', {
                    headers: { 'Authorization': 'Bearer ' + token }
                });
                const data = await res.json();
                
                if (!data.success) {
                    localStorage.clear();
                    window.location.href = '/cloud/login';
                    return;
                }

                currentUserId = data.id;
                isAdmin = data.isAdmin;
                localStorage.setItem('isAdmin', isAdmin.toString());

                // 认证通过，显示主界面
                document.body.dataset.auth = 'true';

                // 显示用户信息
                document.getElementById('user-info').textContent = data.username;
                if (isAdmin) {
                    document.getElementById('admin-badge').style.display = 'inline';
                    document.getElementById('nav-admin').style.display = 'block';
                }

                // 检查是否需要修改密码
                const urlParams = new URLSearchParams(window.location.search);
                if (urlParams.get('reset') === 'true' || data.mustResetPwd) {
                    document.getElementById('reset-pwd-banner').style.display = 'block';
                }

                // 加载文件
                loadFiles();
            } catch (error) {
                console.error('初始化错误:', error);
            }
        })();

        function switchPanel(panel) {
            document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
            document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
            
            document.getElementById('panel-' + panel).classList.add('active');
            event.target.classList.add('active');

            if (panel === 'admin') {
                loadUsers();
            }
        }

        function showMessage(msg, type = 'success') {
            const el = document.getElementById('message');
            el.textContent = msg;
            el.className = 'message ' + type;
            el.style.display = 'block';
            setTimeout(() => el.style.display = 'none', 3000);
        }

        function logout() {
            fetch('/api/auth/logout', {
                method: 'POST',
                headers: { 'Authorization': 'Bearer ' + token }
            });
            localStorage.clear();
            window.location.href = '/cloud/login';
        }

        // 文件管理
        async function loadFiles() {
            try {
                const res = await fetch('/api/files', {
                    headers: { 'Authorization': 'Bearer ' + token }
                });
                const data = await res.json();

                if (!data.success) {
                    showMessage(data.error, 'error');
                    return;
                }

                // 更新存储信息
                updateStorageInfo(data);

                // 渲染文件列表
                const body = document.getElementById('file-list-body');
                
                if (data.files.length === 0) {
                    body.innerHTML = '<div class="empty-state"><h3>暂无文件</h3><p>上传您的第一个文件开始备份</p></div>';
                    return;
                }

                body.innerHTML = data.files.map(file => {
                    const icon = getFileIcon(file.filename);
                    const size = formatSize(file.fileSize);
                    const date = new Date(file.uploadDate).toLocaleString('zh-CN');
                    
                    return '<div class="file-row">' +
                        '<div class="file-name"><span class="file-icon">' + icon + '</span> ' + escapeHtml(file.filename) + '</div>' +
                        '<div class="file-size">' + size + '</div>' +
                        '<div class="file-date">' + date + '</div>' +
                        '<div class="file-actions">' +
                        '<button class="btn btn-download" onclick="downloadFile(\'' + file.id + '\', \'' + escapeHtml(file.filename) + '\')">下载</button>' +
                        '<button class="btn btn-delete" onclick="deleteFile(\'' + file.id + '\')">删除</button>' +
                        '</div></div>';
                }).join('');
            } catch (error) {
                showMessage('加载文件列表失败', 'error');
            }
        }

        function updateStorageInfo(data) {
            const used = data.usedStorage || 0;
            const quota = data.storageQuota || 0;
            const percent = data.storagePercent || 0;

            document.getElementById('storage-bar-fill').style.width = Math.min(percent, 100) + '%';
            document.getElementById('storage-usage').textContent = percent + '%';
            document.getElementById('storage-used').textContent = '已使用: ' + used + 'MB';
            document.getElementById('storage-total').textContent = '配额: ' + quota + 'MB';
        }

        function formatSize(bytes) {
            if (bytes < 1024) return bytes + ' B';
            if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
            if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
            return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
        }

        function getFileIcon(filename) {
            const ext = filename.split('.').pop().toLowerCase();
            const icons = {
                'pdf': '📕', 'doc': '📘', 'docx': '📘', 'xls': '📗', 'xlsx': '📗',
                'ppt': '📙', 'pptx': '📙', 'txt': '📄', 'zip': '📦', 'rar': '📦',
                '7z': '📦', 'tar': '📦', 'gz': '📦', 'jpg': '🖼️', 'jpeg': '🖼️',
                'png': '🖼️', 'gif': '🖼️', 'mp3': '🎵', 'mp4': '🎬', 'wav': '🎵',
                'js': '💻', 'ts': '💻', 'html': '💻', 'css': '💻', 'json': '📋'
            };
            return icons[ext] || '📄';
        }

        function escapeHtml(str) {
            const div = document.createElement('div');
            div.textContent = str;
            return div.innerHTML;
        }

        async function downloadFile(fileId, filename) {
            try {
                const res = await fetch('/api/files/' + fileId + '/download', {
                    headers: { 'Authorization': 'Bearer ' + token }
                });

                if (!res.ok) {
                    const error = await res.json();
                    showMessage(error.error || '下载失败', 'error');
                    return;
                }

                const blob = await res.blob();
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = filename;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
            } catch (error) {
                showMessage('下载失败', 'error');
            }
        }

        async function deleteFile(fileId) {
            if (!confirm('确定要删除这个文件吗？')) return;

            try {
                const res = await fetch('/api/files/' + fileId, {
                    method: 'DELETE',
                    headers: { 'Authorization': 'Bearer ' + token }
                });
                const data = await res.json();

                if (data.success) {
                    showMessage('文件已删除');
                    loadFiles();
                } else {
                    showMessage(data.error || '删除失败', 'error');
                }
            } catch (error) {
                showMessage('删除失败', 'error');
            }
        }

        // 文件上传
        const uploadArea = document.getElementById('upload-area');
        const fileInput = document.getElementById('file-input');

        uploadArea.addEventListener('click', () => fileInput.click());

        uploadArea.addEventListener('dragover', (e) => {
            e.preventDefault();
            uploadArea.classList.add('dragover');
        });

        uploadArea.addEventListener('dragleave', () => {
            uploadArea.classList.remove('dragover');
        });

        uploadArea.addEventListener('drop', (e) => {
            e.preventDefault();
            uploadArea.classList.remove('dragover');
            handleFiles(e.dataTransfer.files);
        });

        fileInput.addEventListener('change', () => {
            handleFiles(fileInput.files);
        });

        async function handleFiles(files) {
            for (const file of files) {
                await uploadFile(file);
            }
        }

        async function uploadFile(file) {
            const progressDiv = document.getElementById('upload-progress');
            const statusEl = document.getElementById('upload-status');
            const fillEl = document.getElementById('upload-progress-fill');

            progressDiv.style.display = 'block';
            statusEl.textContent = '上传中: ' + file.name;
            fillEl.style.width = '0%';

            try {
                const formData = new FormData();
                formData.append('file', file);

                // 使用XMLHttpRequest显示进度
                await new Promise((resolve, reject) => {
                    const xhr = new XMLHttpRequest();
                    xhr.open('POST', '/api/files/upload');
                    xhr.setRequestHeader('Authorization', 'Bearer ' + token);

                    xhr.upload.onprogress = (e) => {
                        if (e.lengthComputable) {
                            const percent = Math.round((e.loaded / e.total) * 100);
                            fillEl.style.width = percent + '%';
                            statusEl.textContent = '上传中: ' + file.name + ' (' + percent + '%)';
                        }
                    };

                    xhr.onload = () => {
                        if (xhr.status === 200) {
                            const data = JSON.parse(xhr.responseText);
                            if (data.success) {
                                showMessage('文件上传成功: ' + file.name);
                                resolve();
                            } else {
                                showMessage(data.error || '上传失败', 'error');
                                reject(new Error(data.error));
                            }
                        } else {
                            showMessage('上传失败', 'error');
                            reject(new Error('Upload failed'));
                        }
                    };

                    xhr.onerror = () => {
                        showMessage('网络错误', 'error');
                        reject(new Error('Network error'));
                    };

                    xhr.send(formData);
                });

                // 刷新文件列表
                loadFiles();
            } catch (error) {
                console.error('Upload error:', error);
            } finally {
                setTimeout(() => {
                    progressDiv.style.display = 'none';
                }, 1000);
                fileInput.value = '';
            }
        }

        // 管理员功能
        async function loadUsers() {
            try {
                const res = await fetch('/api/admin/users', {
                    headers: { 'Authorization': 'Bearer ' + token }
                });
                const data = await res.json();

                if (!data.success) {
                    showMessage(data.error, 'error');
                    return;
                }

                const container = document.getElementById('user-list');
                
                if (data.users.length === 0) {
                    container.innerHTML = '<div class="empty-state"><h3>暂无用户</h3></div>';
                    return;
                }

                container.innerHTML = data.users.map(user => {
                    const isAdminUser = user.isAdmin;
                    const storagePercent = user.storagePercent || 0;
                    const created = new Date(user.createdAt).toLocaleDateString('zh-CN');
                    const lastLogin = user.lastLogin ? new Date(user.lastLogin).toLocaleString('zh-CN') : '从未登录';

                    return '<div class="user-card">' +
                        '<div class="user-info-card">' +
                        '<h4>' + escapeHtml(user.username) + ' ' + (isAdminUser ? '<span class="badge badge-admin">管理员</span>' : '') + '</h4>' +
                        '<p>注册: ' + created + ' | 最后登录: ' + lastLogin + '</p>' +
                        '<p>存储: ' + user.usedStorage + 'MB / ' + user.storageQuota + 'MB (' + storagePercent + '%)</p>' +
                        '</div>' +
                        '<div class="user-quota">' +
                        '<label>配额 (MB)</label><br>' +
                        '<input type="number" value="' + user.storageQuota + '" id="quota-' + user.id + '"> ' +
                        '<button class="btn btn-primary" onclick="updateQuota(\'' + user.id + '\')">更新</button>' +
                        '</div>' +
                        '<div class="user-actions">' +
                        (!isAdminUser ? '<button class="btn" style="background:#fef3c7;color:#92400e" onclick="resetPwd(\'' + user.id + '\')">重置密码</button>' : '') +
                        (!isAdminUser ? '<button class="btn btn-delete" onclick="deleteUser(\'' + user.id + '\', \'' + escapeHtml(user.username) + '\')">删除用户</button>' : '') +
                        '</div></div>';
                }).join('');
            } catch (error) {
                showMessage('加载用户列表失败', 'error');
            }
        }

        async function updateQuota(userId) {
            const quota = document.getElementById('quota-' + userId).value;
            
            try {
                const res = await fetch('/api/admin/users/' + userId + '/quota', {
                    method: 'PUT',
                    headers: {
                        'Authorization': 'Bearer ' + token,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ quota: parseInt(quota) })
                });
                const data = await res.json();

                if (data.success) {
                    showMessage('配额已更新');
                    loadUsers();
                } else {
                    showMessage(data.error || '更新失败', 'error');
                }
            } catch (error) {
                showMessage('更新失败', 'error');
            }
        }

        async function resetPwd(userId) {
            if (!confirm('确定要重置此用户的密码吗？新密码将重置为 123456')) return;

            try {
                const res = await fetch('/api/admin/users/' + userId + '/reset-password', {
                    method: 'POST',
                    headers: { 'Authorization': 'Bearer ' + token }
                });
                const data = await res.json();

                if (data.success) {
                    showMessage('密码已重置为: 123456');
                } else {
                    showMessage(data.error || '重置失败', 'error');
                }
            } catch (error) {
                showMessage('重置失败', 'error');
            }
        }

        async function deleteUser(userId, username) {
            if (!confirm('确定要删除用户 "' + username + '" 吗？\\n\\n此操作将删除该用户的所有文件，且不可恢复！')) return;

            try {
                const res = await fetch('/api/admin/users/' + userId, {
                    method: 'DELETE',
                    headers: { 'Authorization': 'Bearer ' + token }
                });
                const data = await res.json();

                if (data.success) {
                    showMessage('用户已删除: ' + username);
                    loadUsers();
                } else {
                    showMessage(data.error || '删除失败', 'error');
                }
            } catch (error) {
                showMessage('删除失败', 'error');
            }
        }

        // 修改密码
        function showChangePassword() {
            document.getElementById('change-password-modal').classList.add('active');
        }

        function closeModal(id) {
            document.getElementById(id).classList.remove('active');
        }

        async function changePassword() {
            const oldPwd = document.getElementById('old-password').value;
            const newPwd = document.getElementById('new-password').value;
            const confirmPwd = document.getElementById('confirm-password').value;

            if (!oldPwd || !newPwd) {
                showMessage('请填写所有字段', 'error');
                return;
            }

            if (newPwd !== confirmPwd) {
                showMessage('两次输入的新密码不一致', 'error');
                return;
            }

            if (newPwd.length < 6) {
                showMessage('新密码至少需要6个字符', 'error');
                return;
            }

            try {
                const res = await fetch('/api/auth/change-password', {
                    method: 'POST',
                    headers: {
                        'Authorization': 'Bearer ' + token,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ oldPassword: oldPwd, newPassword: newPwd })
                });
                const data = await res.json();

                if (data.success) {
                    showMessage('密码修改成功');
                    closeModal('change-password-modal');
                    document.getElementById('reset-pwd-banner').style.display = 'none';
                    // 清空输入框
                    document.getElementById('old-password').value = '';
                    document.getElementById('new-password').value = '';
                    document.getElementById('confirm-password').value = '';
                } else {
                    showMessage(data.error || '修改失败', 'error');
                }
            } catch (error) {
                showMessage('修改失败', 'error');
            }
        }
    </script>
    </div><!-- /.app-wrapper -->
</body>
</html>`;
}

/**
 * 处理Web UI路由
 */
export function handleCloudUIRoute(req: any, res: ServerResponse): boolean {
  const url = req.url || '';

  // 登录页面
  if (url === '/cloud/login' || url === '/cloud/login/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(getLoginPage());
    return true;
  }

  // 主页面
  if (url === '/cloud' || url === '/cloud/' || url.startsWith('/cloud?')) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(getMainPage());
    return true;
  }

  return false;
}
