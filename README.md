# AuraMusicCanvasServer

Unofficial API to fetch Spotify **Canvas video data** (the looping visual videos that appear behind songs on mobile).  

> [!WARNING]  
> This project uses undocumented endpoints and may violate [Spotify's Terms of Service](https://www.spotify.com/legal/end-user-agreement/). Use at your own risk.

---

## Features

- Retrieve **Canvas video URLs** by track ID or URI
- Parses Protobuf responses from the internal Spotify API
- Works with public or private tracks (as long as you're authenticated)

---

## Example Request

### GET `/api/canvas`

```bash
https://localhost:3000/api/canvas?trackId=3OHfY25tqY28d16oZczHc8
```

### Response:
```json
{
  "data": {
    "canvasesList": [
      {
        "id": "32b57cbf354b453a95eee32bb04d4e42",
        "canvasUrl": "https://canvaz.scdn.co/upload/licensor/5bSw7fRotCnRCcO9br14W5/video/32b57cbf354b453a95eee32bb04d4e42.cnvs.mp4",
        "trackUri": "spotify:track:3OHfY25tqY28d16oZczHc8",
        "artist": {
          "artistUri": "spotify:artist:7tYKF4w9nC0nq9CsPZTHyP",
          "artistName": "SZA",
          "artistImgUrl": "https://i.scdn.co/image/ab6761610000f1780895066d172e1f51f520bc65"
        },
        "otherId": "2c441fceb502eaa25f26bcd5b1ccfc0d",
        "canvasUri": "spotify:canvas:1xGyujDyxbx4eTPD4nKLw6"
      }
    ]
  }
}
```

---

## Setup

### 1. Clone the Repo

```bash
git clone https://github.com/TeamAuraMusic/AuraMusicCanvasServer.git
cd AuraMusicCanvasServer
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Set Required Environment Variable

You must supply your sp_dc cookie from a logged-in Spotify session.

Create a .env file in the root:

```bash
SP_DC=your_sp_dc_cookie_here
```

> This cookie is used to generate an access token to authenticate requests.

---

## Deployment

### Render (recommended)

1. Fork or use this repo directly on Render.
2. Create a new **Web Service** connected to this GitHub repo.
3. Use these settings:
   - Environment: `Node`
   - Build Command: `npm install`
   - Start Command: `npm start`
4. Add environment variable:
   - `SP_DC` = your Spotify `sp_dc` cookie value

Or deploy instantly using the button below (after forking the repo):

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/TeamAuraMusic/AuraMusicCanvasServer)

The included `render.yaml` provides the recommended configuration.

---

### Docker (alternative on Render or elsewhere)

Use the included `Dockerfile`. Render will auto-detect it if you choose Docker environment.

---

## Notes

> I'm developing this project entirely on my phone, without a PC or laptop. Also, I'm still learning — so feel free to send pull requests or suggestions if something looks off!

---

## Reference

Shoutout to this helpful repo that inspired parts of this:
https://github.com/bartleyg/my-spotify-canvas

---

## License

This project is licensed under the MIT license. See [LICENSE](https://github.com/TeamAuraMusic/AuraMusicCanvasServer/blob/main/LICENSE) for details.

---

## Contact

Maintained by TeamAuraMusic.

---