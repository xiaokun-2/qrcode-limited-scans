const express = require('express');
const QRCode = require('qrcode');
const crypto = require('crypto');
const path = require('path');
const { Sequelize, DataTypes } = require('sequelize');

const app = express();
const PORT = process.env.PORT || 3000;

const DATABASE_URL = process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/qrcode_db';

const sequelize = new Sequelize(DATABASE_URL, {
  dialect: 'postgres',
  dialectOptions: {
    ssl: { rejectUnauthorized: false }
  }
});

const QRCodeModel = sequelize.define('QRCode', {
  id: {
    type: DataTypes.STRING(8),
    primaryKey: true,
    allowNull: false
  },
  target_url: {
    type: DataTypes.TEXT,
    allowNull: false
  },
  max_scans: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  },
  current_scans: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  },
  created_at: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW
  },
  updated_at: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW
  },
  qr_image: {
    type: DataTypes.TEXT
  },
  scan_url: {
    type: DataTypes.TEXT
  }
}, {
  tableName: 'qrcodes',
  timestamps: false
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.post('/api/qrcodes', async (req, res) => {
  try {
    const { target_url, max_scans } = req.body;
    if (!target_url) {
      return res.status(400).json({ error: '请提供目标链接' });
    }

    let url = target_url.trim();
    if (!/^https?:\/\//i.test(url)) {
      url = 'https://' + url;
    }

    const id = crypto.randomBytes(4).toString('hex');
    const scanUrl = `${req.protocol}://${req.get('host')}/r/${id}`;
    const qrDataUrl = await QRCode.toDataURL(scanUrl, {
      width: 400,
      margin: 2,
      color: { dark: '#1a1a2e', light: '#ffffff' }
    });

    const now = new Date();
    const qr = await QRCodeModel.create({
      id,
      target_url: url,
      max_scans: max_scans || 0,
      current_scans: 0,
      created_at: now,
      updated_at: now,
      qr_image: qrDataUrl,
      scan_url: scanUrl
    });

    res.json(qr.toJSON());
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

app.get('/r/:id', async (req, res) => {
  try {
    const qr = await QRCodeModel.findByPk(req.params.id);
    if (!qr) {
      return res.status(404).sendFile(path.join(__dirname, 'public', 'not-found.html'));
    }

    if (qr.max_scans > 0 && qr.current_scans >= qr.max_scans) {
      return res.status(410).sendFile(path.join(__dirname, 'public', 'expired.html'));
    }

    qr.current_scans += 1;
    qr.updated_at = new Date();
    await qr.save();

    res.redirect(qr.target_url);
  } catch (err) {
    console.error(err);
    res.status(500).send('服务器错误');
  }
});

app.get('/api/qrcodes', async (req, res) => {
  try {
    const qrs = await QRCodeModel.findAll({
      order: [['created_at', 'DESC']]
    });
    res.json(qrs.map(q => q.toJSON()));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

app.delete('/api/qrcodes/:id', async (req, res) => {
  try {
    const qr = await QRCodeModel.findByPk(req.params.id);
    if (!qr) {
      return res.status(404).json({ error: '二维码不存在' });
    }
    await qr.destroy();
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

app.put('/api/qrcodes/:id/reset', async (req, res) => {
  try {
    const qr = await QRCodeModel.findByPk(req.params.id);
    if (!qr) {
      return res.status(404).json({ error: '二维码不存在' });
    }
    qr.current_scans = 0;
    qr.updated_at = new Date();
    await qr.save();
    res.json({ success: true, current_scans: 0 });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

async function init() {
  console.log('='.repeat(50));
  console.log('  二维码限制次数服务启动中...');
  console.log('='.repeat(50));
  console.log(`  环境变量 NODE_ENV: ${process.env.NODE_ENV || '未设置'}`);
  console.log(`  环境变量 RAILWAY_ENVIRONMENT: ${process.env.RAILWAY_ENVIRONMENT || '未设置'}`);
  console.log(`  环境变量 DATABASE_URL 存在: ${!!process.env.DATABASE_URL}`);
  console.log(`  端口: ${PORT}`);
  console.log(`  SSL 连接: 已启用`);
  console.log('='.repeat(50));

  try {
    await sequelize.authenticate();
    console.log('数据库连接成功');
    await QRCodeModel.sync({ alter: true });
    console.log('数据库表同步完成');
    
    app.listen(PORT, () => {
      console.log('='.repeat(50));
      console.log('  二维码限制次数服务已启动');
      console.log('='.repeat(50));
      console.log(`  端口: ${PORT}`);
      console.log('='.repeat(50));
    });
  } catch (err) {
    console.error('='.repeat(50));
    console.error('  数据库初始化失败');
    console.error('='.repeat(50));
    console.error('  错误信息:', err.message);
    console.error('  错误堆栈:', err.stack);
    console.error('='.repeat(50));
    process.exit(1);
  }
}

init();