# Lumino 协作服务器

这是一个基于 Node.js + TypeScript 的多人在线协作编辑服务器，配合 lumino-rs 客户端实现实时协作音乐编辑。

## 功能特性

- **用户认证** - 支持自定义用户名登录
- **房间管理** - 创建/加入/离开协作房间
- **邀请码系统** - 通过6位邀请码加入房间
- **实时鼠标追踪** - 显示所有协作者的鼠标位置
- **音符批量操作** - 高效传输复制/粘贴等批量操作
- **MIDI事件同步** - 实时同步音符事件
- **项目状态同步** - 同步视图状态、工程文件等
- **自动重连** - 支持断线重连
- **心跳检测** - 保持连接活跃

## 快速开始

### 安装依赖

```bash
npm install
```

### 开发模式

```bash
npm run dev
```

### 构建

```bash
npm run build
```

### 启动

```bash
npm start
```

## API 文档

### WebSocket 连接

```
ws://localhost:3000/ws
```

### 消息类型

#### 客户端 → 服务器

| 类型 | 说明 |
|------|------|
| `auth` | 认证，发送用户名 |
| `createRoom` | 创建协作房间 |
| `joinRoom` | 使用邀请码加入房间 |
| `leaveRoom` | 离开当前房间 |
| `mouseMove` | 发送鼠标位置 |
| `noteBatch` | 音符批量操作 |
| `midiEvent` | MIDI事件 |
| `midiEventBatch` | MIDI事件批量 |
| `projectUpdate` | 项目状态更新 |
| `requestSync` | 请求完整同步 |
| `ping` | 心跳 |

#### 服务器 → 客户端

| 类型 | 说明 |
|------|------|
| `authSuccess` | 认证成功，返回用户ID和邀请码 |
| `authError` | 认证失败 |
| `roomCreated` | 房间创建成功 |
| `roomJoined` | 加入房间成功 |
| `userJoined` | 新用户加入 |
| `userLeft` | 用户离开 |
| `mouseUpdate` | 鼠标位置更新 |
| `noteBatchUpdate` | 音符批量操作更新 |
| `midiEventUpdate` | MIDI事件更新 |
| `fullSync` | 完整状态同步 |
| `pong` | 心跳响应 |

### HTTP API

- `GET /health` - 健康检查
- `GET /info` - 服务器信息

## 数据结构

### 音符 (Note)

```typescript
{
  id: string;
  tick: number;      // 时间位置
  key: number;       // 音高
  length: number;    // 长度
  velocity: number;  // 力度
  channel: number;   // MIDI通道
  trackIndex: number;
}
```

### 鼠标位置 (MousePosition)

```typescript
{
  x: number;
  y: number;
  viewState?: ViewState;
}
```

### 视图状态 (ViewState)

```typescript
{
  scroll_x: number;
  scroll_y: number;
  zoom_x: number;
  zoom_y: number;
  total_ticks: number;
  key_count: number;
  visible_key_count: number;
  ppq: number;
  keyboard_width: number;
  snap_precision: number;
  default_note_length: number;
}
```

## 配置

环境变量：

- `PORT` - 服务器端口 (默认: 3000)
- `HOST` - 服务器地址 (默认: 0.0.0.0)

## lumino-rs 客户端集成

客户端代码位于 `lumino-rs/crates/collaboration/`，实现了：

- WebSocket连接管理
- 自动重连
- 消息序列化/反序列化
- 事件回调系统
- 协作会话管理

### 使用示例

```rust
use lumino_collaboration::{CollaborationClient, ClientConfig, CollaborationEvent};

let config = ClientConfig {
    server_host: "localhost".to_string(),
    server_port: 3000,
    username: "用户名".to_string(),
    ..Default::default()
};

let mut client = CollaborationClient::new(config);

// 设置事件回调
client.set_event_callback(|event| {
    match event {
        CollaborationEvent::Authenticated { user_id, invite_code } => {
            println!("认证成功！邀请码: {}", invite_code);
        }
        CollaborationEvent::MouseUpdate { user_id, position, color } => {
            // 在其他用户位置显示光标
        }
        CollaborationEvent::NoteBatch { user_id, operation } => {
            // 应用远程用户的音符操作
        }
        _ => {}
    }
});

// 连接服务器
client.connect(None, None).await?;

// 创建房间
client.create_room("我的房间".to_string())?;

// 发送鼠标位置
client.send_mouse_position(MousePosition { x: 100.0, y: 200.0 })?;
```

## 架构图

```
┌─────────────────────────────────────────────────────────────┐
│                        客户端 (lumino-rs)                    │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │ 编辑器UI    │  │ 协作管理器   │  │ WebSocket客户端      │  │
│  │             │◄─┤             │◄─┤                     │  │
│  │ 音符编辑    │  │ 事件处理    │  │ tokio-tungstenite   │  │
│  │ 鼠标追踪    │  │ 状态同步    │  │                     │  │
│  └─────────────┘  └─────────────┘  └─────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                           │
                           │ WebSocket
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                      服务器 (Node.js)                        │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │ HTTP服务    │  │ 房间管理器   │  │ 消息处理器          │  │
│  │ /health     │  │ - 创建房间  │  │ - 认证              │  │
│  │ /info       │  │ - 加入房间  │  │ - 广播              │  │
│  └─────────────┘  │ - 用户管理  │  │ - 状态同步          │  │
│                   └─────────────┘  └─────────────────────┘  │
│  ┌─────────────────────────────────────────────────────────┐│
│  │              WebSocket Server (ws库)                    ││
│  │  - 心跳检测  - 消息路由  - 连接管理                      ││
│  └─────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────┘
```

## 许可证

MIT
