const assert = require('node:assert/strict');
const test = require('node:test');

const { loadProto, types } = require('../dist/utils/proto');
const { normalizeShop, bagItemCount, shouldSellNow } = require('../dist/services/sweet-potato');

// 抓包夹具（2026-11-25/26 官方客户端回包，base64 的 gatepb.Message.body）
const SHOP_SELF = 'CNyFkMYHEFwa+AoK0QoI3IWQxgcQ24WQxgcYGiIM5Lul6Jav5o2i56aPKpYKewogICJ1aWQiOiAiWWlTaHVIdWFuRnVNYWluVUkiLAogICJ0aXBzIjogewogICAgInRpdGxlIjogIua0u+WKqOivtOaYjiIsCiAgICAidHh0IjogWwogICAgICAiPGI+44CQ5rS75Yqo5pe26Ze044CRPC9iPiIsCiAgICAgICIyMDI25bm0MTHmnIgyNeaXpSDigJQgMjAyNuW5tDEy5pyIOeaXpSIsCiAgICAgICI8Yj7jgJDmtLvliqjnroDku4vjgJE8L2I+IiwKICAgICAgIjEuIOa0u+WKqOacn+mXtO+8jOWGnOWcuuS4u+WPr+WcqOS4u+eVjOmdoui/m+WFpeOAjOS7peiWr+aNouemj+OAje+8jOmAmui/h+mihuWPlue6ouiWr+enjeWtkO+8jOenjeakjee6ouiWr+mineWkluaUtuiOt+icnOiWr+OAguWUruWNluicnOiWr+iOt+W+l+emj+awlOW4ge+8jOW5tuWFkeaNouebhuagvcK35LiD6Imy6Iqx5bym44CB56aP5rCU6YeR6LGG56S85YyF5LiO5a6e55So6YGT5YW344CCIiwKICAgICAgIjIuIOavj+aXpeeOqeazle+8miIsCiAgICAgICLvvIgx77yJ5b2T5pel6aaW5qyh6L+b5YWl5rS75Yqo6Ieq5Yqo5by55Ye644CM5LuK5pel5ZSu5Lu344CN77yM5Y+v6aKG5Y+W57qi6Jav56eN5a2Q44CCIiwKICAgICAgIu+8iDLvvInnuqLolq/np43lrZDnp43lhaXmma7pgJrlhpznlLDvvIzmiJDnhp/lkI7mlLbojrfnuqLolq/vvIzlubbpop3lpJbmlLbojrfonJzolq/jgIIiLAogICAgICAi77yIM++8ieicnOiWr+WPr+WNlue7meiHquW3semTuuWtkO+8jOaMieacrOS6uuW9k+aXpeaUtui0reS7t+WHuuWUru+8jOS4jemZkOmHj++8m+S5n+WPr+mAmui/h+WlveWPi+WIhuS6q+eahOe6ouiWr+mTuuWNoeeJh+i/m+WFpeWlveWPi+mTuuWtkOWUruWNlu+8jOaMieWvueaWuemTuuWtkOW9k+aXpeS7t+agvOWHuuWUru+8jOWNoOeUqOWvueaWueavj+aXpeaOpeaUtumineW6pu+8jOWlveWPi+i/mOS8muiOt+W+l+emj+awlOW4geWIhue6oiIsCiAgICAgICIzLiDliIbkuqvmmrTlh7vvvJoiLAogICAgICAi77yIMe+8ieavj+aXpemmluasoeaIkOWKn+aKiuiHquW3seeahOmTuuWtkOWIhuS6q+e7mSBRUS/lvq7kv6Hlpb3lj4vmiJbnvqTogYrvvIzljbPop6blj5HkuIDmrKHliIbkuqvmmrTlh7vjgIIiLAogICAgICAi77yIMu+8ieaatOWHu+a2qOS7t+avj+aXpSAwIOeCuea4hembtu+8jOasoeaXpemHjeaWsOinpuWPkeOAgiIsCiAgICAgICI0LiDmr4/ml6UgMjQ6MDDvvIzns7vnu5/oh6rliqjmjInmnKzkurrpk7rlrZDlvZPml6XmnIDnu4jmlLbotK3ku7fllK7lh7rnjqnlrrbmjIHmnInnmoTlhajpg6jonJzolq/vvIznpo/msJTluIHlhaXotKbvvIzonJzolq/muIXpm7bjgIIiCiAgICBdCiAgfQp9MKCCmdgGOP/15dgGQL8BoAEBuAEBwAH/9eXYBpIIIQoECAEQARIMCCEQARi65pnYBiABGHwiAhABKFswITi6aoIMfQp5CFsQIRjAPiJwCPXsg+EDEhXkuIDlj6rlsI/mlofoibrltL3lrZAaTmh0dHBzOi8vdGhpcmRxcS5xbG9nby5jbi9xcWFwcC8xMTEyMzg2MDI5L0UwREVFOTNBQ0U2OEFBQ0FFRDI0RDU5NzIyRUU0MzY3LzEwMCCgARAB';
const SHOP_FRIEND = 'CNyFkMYHEFwa9goK0QoI3IWQxgcQ24WQxgcYGiIM5Lul6Jav5o2i56aPKpYKewogICJ1aWQiOiAiWWlTaHVIdWFuRnVNYWluVUkiLAogICJ0aXBzIjogewogICAgInRpdGxlIjogIua0u+WKqOivtOaYjiIsCiAgICAidHh0IjogWwogICAgICAiPGI+44CQ5rS75Yqo5pe26Ze044CRPC9iPiIsCiAgICAgICIyMDI25bm0MTHmnIgyNeaXpSDigJQgMjAyNuW5tDEy5pyIOeaXpSIsCiAgICAgICI8Yj7jgJDmtLvliqjnroDku4vjgJE8L2I+IiwKICAgICAgIjEuIOa0u+WKqOacn+mXtO+8jOWGnOWcuuS4u+WPr+WcqOS4u+eVjOmdoui/m+WFpeOAjOS7peiWr+aNouemj+OAje+8jOmAmui/h+mihuWPlue6ouiWr+enjeWtkO+8jOenjeakjee6ouiWr+mineWkluaUtuiOt+icnOiWr+OAguWUruWNluicnOiWr+iOt+W+l+emj+awlOW4ge+8jOW5tuWFkeaNouebhuagvcK35LiD6Imy6Iqx5bym44CB56aP5rCU6YeR6LGG56S85YyF5LiO5a6e55So6YGT5YW344CCIiwKICAgICAgIjIuIOavj+aXpeeOqeazle+8miIsCiAgICAgICLvvIgx77yJ5b2T5pel6aaW5qyh6L+b5YWl5rS75Yqo6Ieq5Yqo5by55Ye644CM5LuK5pel5ZSu5Lu344CN77yM5Y+v6aKG5Y+W57qi6Jav56eN5a2Q44CCIiwKICAgICAgIu+8iDLvvInnuqLolq/np43lrZDnp43lhaXmma7pgJrlhpznlLDvvIzmiJDnhp/lkI7mlLbojrfnuqLolq/vvIzlubbpop3lpJbmlLbojrfonJzolq/jgIIiLAogICAgICAi77yIM++8ieicnOiWr+WPr+WNlue7meiHquW3semTuuWtkO+8jOaMieacrOS6uuW9k+aXpeaUtui0reS7t+WHuuWUru+8jOS4jemZkOmHj++8m+S5n+WPr+mAmui/h+WlveWPi+WIhuS6q+eahOe6ouiWr+mTuuWNoeeJh+i/m+WFpeWlveWPi+mTuuWtkOWUruWNlu+8jOaMieWvueaWuemTuuWtkOW9k+aXpeS7t+agvOWHuuWUru+8jOWNoOeUqOWvueaWueavj+aXpeaOpeaUtumineW6pu+8jOWlveWPi+i/mOS8muiOt+W+l+emj+awlOW4geWIhue6oiIsCiAgICAgICIzLiDliIbkuqvmmrTlh7vvvJoiLAogICAgICAi77yIMe+8ieavj+aXpemmluasoeaIkOWKn+aKiuiHquW3seeahOmTuuWtkOWIhuS6q+e7mSBRUS/lvq7kv6Hlpb3lj4vmiJbnvqTogYrvvIzljbPop6blj5HkuIDmrKHliIbkuqvmmrTlh7vjgIIiLAogICAgICAi77yIMu+8ieaatOWHu+a2qOS7t+avj+aXpSAwIOeCuea4hembtu+8jOasoeaXpemHjeaWsOinpuWPkeOAgiIsCiAgICAgICI0LiDmr4/ml6UgMjQ6MDDvvIzns7vnu5/oh6rliqjmjInmnKzkurrpk7rlrZDlvZPml6XmnIDnu4jmlLbotK3ku7fllK7lh7rnjqnlrrbmjIHmnInnmoTlhajpg6jonJzolq/vvIznpo/msJTluIHlhaXotKbvvIzonJzolq/muIXpm7bjgIIiCiAgICBdCiAgfQp9MKCCmdgGOP/15dgGQL8BoAEBuAEBwAH/9eXYBpIIHwoECAEQARIMCCEQARi65pnYBiABIgIQAShbMCE4umqCDG4KaghTEEIYwD4iYQiYy6rdAxIG6Zm15rGfGk5odHRwczovL3RoaXJkcXEucWxvZ28uY24vcXFhcHAvMTExMjM4NjAyOS8wNUY3NTQ0QTRERjg4RTA1OUNFMTREOUEzNEZGMEVCRi8xMDAgkgEQAQ==';
const SELL = 'CNyFkMYHEF0a+AoK0QoI3IWQxgcQ24WQxgcYGiIM5Lul6Jav5o2i56aPKpYKewogICJ1aWQiOiAiWWlTaHVIdWFuRnVNYWluVUkiLAogICJ0aXBzIjogewogICAgInRpdGxlIjogIua0u+WKqOivtOaYjiIsCiAgICAidHh0IjogWwogICAgICAiPGI+44CQ5rS75Yqo5pe26Ze044CRPC9iPiIsCiAgICAgICIyMDI25bm0MTHmnIgyNeaXpSDigJQgMjAyNuW5tDEy5pyIOeaXpSIsCiAgICAgICI8Yj7jgJDmtLvliqjnroDku4vjgJE8L2I+IiwKICAgICAgIjEuIOa0u+WKqOacn+mXtO+8jOWGnOWcuuS4u+WPr+WcqOS4u+eVjOmdoui/m+WFpeOAjOS7peiWr+aNouemj+OAje+8jOmAmui/h+mihuWPlue6ouiWr+enjeWtkO+8jOenjeakjee6ouiWr+mineWkluaUtuiOt+icnOiWr+OAguWUruWNluicnOiWr+iOt+W+l+emj+awlOW4ge+8jOW5tuWFkeaNouebhuagvcK35LiD6Imy6Iqx5bym44CB56aP5rCU6YeR6LGG56S85YyF5LiO5a6e55So6YGT5YW344CCIiwKICAgICAgIjIuIOavj+aXpeeOqeazle+8miIsCiAgICAgICLvvIgx77yJ5b2T5pel6aaW5qyh6L+b5YWl5rS75Yqo6Ieq5Yqo5by55Ye644CM5LuK5pel5ZSu5Lu344CN77yM5Y+v6aKG5Y+W57qi6Jav56eN5a2Q44CCIiwKICAgICAgIu+8iDLvvInnuqLolq/np43lrZDnp43lhaXmma7pgJrlhpznlLDvvIzmiJDnhp/lkI7mlLbojrfnuqLolq/vvIzlubbpop3lpJbmlLbojrfonJzolq/jgIIiLAogICAgICAi77yIM++8ieicnOiWr+WPr+WNlue7meiHquW3semTuuWtkO+8jOaMieacrOS6uuW9k+aXpeaUtui0reS7t+WHuuWUru+8jOS4jemZkOmHj++8m+S5n+WPr+mAmui/h+WlveWPi+WIhuS6q+eahOe6ouiWr+mTuuWNoeeJh+i/m+WFpeWlveWPi+mTuuWtkOWUruWNlu+8jOaMieWvueaWuemTuuWtkOW9k+aXpeS7t+agvOWHuuWUru+8jOWNoOeUqOWvueaWueavj+aXpeaOpeaUtumineW6pu+8jOWlveWPi+i/mOS8muiOt+W+l+emj+awlOW4geWIhue6oiIsCiAgICAgICIzLiDliIbkuqvmmrTlh7vvvJoiLAogICAgICAi77yIMe+8ieavj+aXpemmluasoeaIkOWKn+aKiuiHquW3seeahOmTuuWtkOWIhuS6q+e7mSBRUS/lvq7kv6Hlpb3lj4vmiJbnvqTogYrvvIzljbPop6blj5HkuIDmrKHliIbkuqvmmrTlh7vjgIIiLAogICAgICAi77yIMu+8ieaatOWHu+a2qOS7t+avj+aXpSAwIOeCuea4hembtu+8jOasoeaXpemHjeaWsOinpuWPkeOAgiIsCiAgICAgICI0LiDmr4/ml6UgMjQ6MDDvvIzns7vnu5/oh6rliqjmjInmnKzkurrpk7rlrZDlvZPml6XmnIDnu4jmlLbotK3ku7fllK7lh7rnjqnlrrbmjIHmnInnmoTlhajpg6jonJzolq/vvIznpo/msJTluIHlhaXotKbvvIzonJzolq/muIXpm7bjgIIiCiAgICBdCiAgfQp9MKCCmdgGOP/15dgGQL8BoAEBuAEBwAH/9eXYBpIIIQoECAEQARIMCCEQARi65pnYBiABGHwiAhABKFswITi6aooMCwgBEHwYfCDAPih8';
const CATALOG_BEFORE = 'CNyFkMYHEGEa+woK0QoI3IWQxgcQ24WQxgcYGiIM5Lul6Jav5o2i56aPKpYKewogICJ1aWQiOiAiWWlTaHVIdWFuRnVNYWluVUkiLAogICJ0aXBzIjogewogICAgInRpdGxlIjogIua0u+WKqOivtOaYjiIsCiAgICAidHh0IjogWwogICAgICAiPGI+44CQ5rS75Yqo5pe26Ze044CRPC9iPiIsCiAgICAgICIyMDI25bm0MTHmnIgyNeaXpSDigJQgMjAyNuW5tDEy5pyIOeaXpSIsCiAgICAgICI8Yj7jgJDmtLvliqjnroDku4vjgJE8L2I+IiwKICAgICAgIjEuIOa0u+WKqOacn+mXtO+8jOWGnOWcuuS4u+WPr+WcqOS4u+eVjOmdoui/m+WFpeOAjOS7peiWr+aNouemj+OAje+8jOmAmui/h+mihuWPlue6ouiWr+enjeWtkO+8jOenjeakjee6ouiWr+mineWkluaUtuiOt+icnOiWr+OAguWUruWNluicnOiWr+iOt+W+l+emj+awlOW4ge+8jOW5tuWFkeaNouebhuagvcK35LiD6Imy6Iqx5bym44CB56aP5rCU6YeR6LGG56S85YyF5LiO5a6e55So6YGT5YW344CCIiwKICAgICAgIjIuIOavj+aXpeeOqeazle+8miIsCiAgICAgICLvvIgx77yJ5b2T5pel6aaW5qyh6L+b5YWl5rS75Yqo6Ieq5Yqo5by55Ye644CM5LuK5pel5ZSu5Lu344CN77yM5Y+v6aKG5Y+W57qi6Jav56eN5a2Q44CCIiwKICAgICAgIu+8iDLvvInnuqLolq/np43lrZDnp43lhaXmma7pgJrlhpznlLDvvIzmiJDnhp/lkI7mlLbojrfnuqLolq/vvIzlubbpop3lpJbmlLbojrfonJzolq/jgIIiLAogICAgICAi77yIM++8ieicnOiWr+WPr+WNlue7meiHquW3semTuuWtkO+8jOaMieacrOS6uuW9k+aXpeaUtui0reS7t+WHuuWUru+8jOS4jemZkOmHj++8m+S5n+WPr+mAmui/h+WlveWPi+WIhuS6q+eahOe6ouiWr+mTuuWNoeeJh+i/m+WFpeWlveWPi+mTuuWtkOWUruWNlu+8jOaMieWvueaWuemTuuWtkOW9k+aXpeS7t+agvOWHuuWUru+8jOWNoOeUqOWvueaWueavj+aXpeaOpeaUtumineW6pu+8jOWlveWPi+i/mOS8muiOt+W+l+emj+awlOW4geWIhue6oiIsCiAgICAgICIzLiDliIbkuqvmmrTlh7vvvJoiLAogICAgICAi77yIMe+8ieavj+aXpemmluasoeaIkOWKn+aKiuiHquW3seeahOmTuuWtkOWIhuS6q+e7mSBRUS/lvq7kv6Hlpb3lj4vmiJbnvqTogYrvvIzljbPop6blj5HkuIDmrKHliIbkuqvmmrTlh7vjgIIiLAogICAgICAi77yIMu+8ieaatOWHu+a2qOS7t+avj+aXpSAwIOeCuea4hembtu+8jOasoeaXpemHjeaWsOinpuWPkeOAgiIsCiAgICAgICI0LiDmr4/ml6UgMjQ6MDDvvIzns7vnu5/oh6rliqjmjInmnKzkurrpk7rlrZDlvZPml6XmnIDnu4jmlLbotK3ku7fllK7lh7rnjqnlrrbmjIHmnInnmoTlhajpg6jonJzolq/vvIznpo/msJTluIHlhaXotKbvvIzonJzolq/muIXpm7bjgIIiCiAgICBdCiAgfQp9MKCCmdgGOP/15dgGQL8BoAEBuAEBwAH/9eXYBpIIJAoECAEQARIMCEIQAhi33p/YBiABGPmjHyICEAEoWDBCONyIAaoMjAEKCggBEMCEPRgCIAEKDAgCEODUAxgCIBw4AQoMCAMQwLgCGAIgKDgBCgwIBBDAuAIYAiAoOAEKCwgFELRCGAIgMjgBCgwIBhDg2gEYAiAKOAEKDAgHEODaARgCIAo4AQoMCAgQ4NoBGAIgCjgBCgwICRC4kQIYAiAKOAEKCwgKENg2GAIgMjgBEPmjHw==';
const CATALOG_AFTER = 'CNyFkMYHEGEa+woK0QoI3IWQxgcQ24WQxgcYGiIM5Lul6Jav5o2i56aPKpYKewogICJ1aWQiOiAiWWlTaHVIdWFuRnVNYWluVUkiLAogICJ0aXBzIjogewogICAgInRpdGxlIjogIua0u+WKqOivtOaYjiIsCiAgICAidHh0IjogWwogICAgICAiPGI+44CQ5rS75Yqo5pe26Ze044CRPC9iPiIsCiAgICAgICIyMDI25bm0MTHmnIgyNeaXpSDigJQgMjAyNuW5tDEy5pyIOeaXpSIsCiAgICAgICI8Yj7jgJDmtLvliqjnroDku4vjgJE8L2I+IiwKICAgICAgIjEuIOa0u+WKqOacn+mXtO+8jOWGnOWcuuS4u+WPr+WcqOS4u+eVjOmdoui/m+WFpeOAjOS7peiWr+aNouemj+OAje+8jOmAmui/h+mihuWPlue6ouiWr+enjeWtkO+8jOenjeakjee6ouiWr+mineWkluaUtuiOt+icnOiWr+OAguWUruWNluicnOiWr+iOt+W+l+emj+awlOW4ge+8jOW5tuWFkeaNouebhuagvcK35LiD6Imy6Iqx5bym44CB56aP5rCU6YeR6LGG56S85YyF5LiO5a6e55So6YGT5YW344CCIiwKICAgICAgIjIuIOavj+aXpeeOqeazle+8miIsCiAgICAgICLvvIgx77yJ5b2T5pel6aaW5qyh6L+b5YWl5rS75Yqo6Ieq5Yqo5by55Ye644CM5LuK5pel5ZSu5Lu344CN77yM5Y+v6aKG5Y+W57qi6Jav56eN5a2Q44CCIiwKICAgICAgIu+8iDLvvInnuqLolq/np43lrZDnp43lhaXmma7pgJrlhpznlLDvvIzmiJDnhp/lkI7mlLbojrfnuqLolq/vvIzlubbpop3lpJbmlLbojrfonJzolq/jgIIiLAogICAgICAi77yIM++8ieicnOiWr+WPr+WNlue7meiHquW3semTuuWtkO+8jOaMieacrOS6uuW9k+aXpeaUtui0reS7t+WHuuWUru+8jOS4jemZkOmHj++8m+S5n+WPr+mAmui/h+WlveWPi+WIhuS6q+eahOe6ouiWr+mTuuWNoeeJh+i/m+WFpeWlveWPi+mTuuWtkOWUruWNlu+8jOaMieWvueaWuemTuuWtkOW9k+aXpeS7t+agvOWHuuWUru+8jOWNoOeUqOWvueaWueavj+aXpeaOpeaUtumineW6pu+8jOWlveWPi+i/mOS8muiOt+W+l+emj+awlOW4geWIhue6oiIsCiAgICAgICIzLiDliIbkuqvmmrTlh7vvvJoiLAogICAgICAi77yIMe+8ieavj+aXpemmluasoeaIkOWKn+aKiuiHquW3seeahOmTuuWtkOWIhuS6q+e7mSBRUS/lvq7kv6Hlpb3lj4vmiJbnvqTogYrvvIzljbPop6blj5HkuIDmrKHliIbkuqvmmrTlh7vjgIIiLAogICAgICAi77yIMu+8ieaatOWHu+a2qOS7t+avj+aXpSAwIOeCuea4hembtu+8jOasoeaXpemHjeaWsOinpuWPkeOAgiIsCiAgICAgICI0LiDmr4/ml6UgMjQ6MDDvvIzns7vnu5/oh6rliqjmjInmnKzkurrpk7rlrZDlvZPml6XmnIDnu4jmlLbotK3ku7fllK7lh7rnjqnlrrbmjIHmnInnmoTlhajpg6jonJzolq/vvIznpo/msJTluIHlhaXotKbvvIzonJzolq/muIXpm7bjgIIiCiAgICBdCiAgfQp9MKCCmdgGOP/15dgGQL8BoAEBuAEBwAH/9eXYBpIIJAoECAEQARIMCEIQAhi33p/YBiABGJnPGyICEAEoWDBCONyIAaoMkAEKCggBEMCEPRgCIAEKEAgCEODUAxgCIBwoATABOAEKDAgDEMC4AhgCICg4AQoMCAQQwLgCGAIgKDgBCgsIBRC0QhgCIDI4AQoMCAYQ4NoBGAIgCjgBCgwIBxDg2gEYAiAKOAEKDAgIEODaARgCIAo4AQoMCAkQuJECGAIgCjgBCgsIChDYNhgCIDI4ARCZzxs=';

function decodeShop(b64) {
    const reply = types.YshfOperateReply.decode(Buffer.from(b64, 'base64'));
    return { reply, shop: normalizeShop(reply.shop_192, String(reply.shop_192?.quote?.shop?.gid || '')) };
}

test('以薯换福：自己铺子成交价 = base_price + bonus_price', async () => {
    await loadProto();
    const { reply, shop } = decodeShop(SHOP_SELF);
    assert.equal(Number(reply.cmd), 92);
    assert.equal(shop.basePrice, 91);
    assert.equal(shop.bonusPrice, 33);
    assert.equal(shop.price, 124);
    assert.equal(shop.quota, 8000);
    assert.equal(shop.name, '一只小文艺崽子');
});

test('以薯换福：好友铺子行情用同一规则合成', async () => {
    await loadProto();
    const { shop } = decodeShop(SHOP_FRIEND);
    assert.equal(shop.basePrice, 83);
    assert.equal(shop.bonusPrice, 66);
    assert.equal(shop.price, 149);
    assert.equal(shop.name, '陵江');
});

test('以薯换福：出售回执字段（balance 是余额不是当日价）', async () => {
    await loadProto();
    const reply = types.YshfOperateReply.decode(Buffer.from(SELL, 'base64'));
    assert.equal(Number(reply.cmd), 93);
    const result = reply.sell_193;
    assert.equal(String(result.count), '1');
    assert.equal(String(result.price), '124');
    assert.equal(String(result.total), '124');
    assert.equal(String(result.quota), '8000');
    assert.equal(String(result.balance), '124');
});

test('以薯换福：出售请求编码与官方抓包逐字节一致', async () => {
    await loadProto();
    const body = Buffer.from(types.YshfOperateRequest.encode(types.YshfOperateRequest.create({
        activity_id: '2026111708',
        cmd: 93,
        params_193: { shop_gid: '1008793205', count: '1' },
    })).finish());
    assert.equal(body.toString('hex'), '08dc8590c607105d8a0c0808f5ec83e1031001');
});

test('以薯换福：查铺子与兑换请求编码逐字节一致', async () => {
    await loadProto();
    const query = Buffer.from(types.YshfOperateRequest.encode(types.YshfOperateRequest.create({
        activity_id: '2026111708', cmd: 92, params_192: { shop_gid: '1001039256' },
    })).finish());
    assert.equal(query.toString('hex'), '08dc8590c607105c820c060898cbaadd03');
    const exchange = Buffer.from(types.YshfOperateRequest.encode(types.YshfOperateRequest.create({
        activity_id: '2026111708', cmd: 96, params_196: { index: '2', count: '1' },
    })).finish());
    assert.equal(exchange.toString('hex'), '08dc8590c6071060a20c0408021001');
});

test('以薯换福：兑换目录解码出 10 档并带余额', async () => {
    await loadProto();
    const reply = types.YshfOperateReply.decode(Buffer.from(CATALOG_BEFORE, 'base64'));
    assert.equal(Number(reply.cmd), 97);
    const catalog = reply.catalog_197;
    assert.equal(String(catalog.balance), '512505');
    assert.equal(catalog.goods.length, 10);
    assert.equal(String(catalog.goods[0].index), '1');
    assert.equal(String(catalog.goods[0].price), '1000000');
    assert.equal(String(catalog.goods[0].limit), '1');
    assert.equal(String(catalog.goods[1].index), '2');
    assert.equal(String(catalog.goods[1].price), '60000');
    assert.equal(String(catalog.goods[1].limit), '28');
});

test('以薯换福：兑换后余额扣减、档位已购数递增', async () => {
    await loadProto();
    const reply = types.YshfOperateReply.decode(Buffer.from(CATALOG_AFTER, 'base64'));
    const catalog = reply.catalog_197;
    assert.equal(String(catalog.balance), '452505');
    const beans = catalog.goods.find(item => String(item.index) === '2');
    assert.equal(String(beans.field_5), '1');
});

test('以薯换福：状态槽解析出基础价、暴击加成与接收总量', async () => {
    await loadProto();
    const reply = types.YshfOperateReply.decode(Buffer.from(CATALOG_AFTER, 'base64'));
    const state = reply.data.yishuhuanfu;
    assert.equal(String(state.base_price), '88');
    assert.equal(String(state.bonus_price), '66');
    assert.equal(Number(state.base_price) + Number(state.bonus_price), 154);
    assert.equal(String(state.luck_coin), '452505');
    assert.equal(String(state.capacity), '17500');
    assert.equal(state.claims.share_claimed, true);
});

test('以薯换福：蜜薯与福气币按道具 id 汇总', () => {
    const bag = { item_bag: { items: [{ id: '1032', count: '30' }, { id: '1033', count: '124' }, { id: '1032', count: '2' }] } };
    assert.equal(bagItemCount(bag, '1032'), 32);
    assert.equal(bagItemCount(bag, '1033'), 124);
    assert.equal(bagItemCount(bag, '9999'), 0);
});

test('以薯换福：出售时间闸门按 HH:MM 生效', () => {
    const base = { sellAfterTime: '' };
    assert.equal(shouldSellNow({ ...base }), true);
    const now = Date.now();
    assert.equal(shouldSellNow({ sellAfterTime: '00:00' }, now), true);
    assert.equal(shouldSellNow({ sellAfterTime: '23:59' }, now), false);
});
test('以薯换福：兑换目录序号映射到官方道具 id 与图标', () => {
    const { describeCatalogItem } = require('../dist/services/sweet-potato');
    const coin = describeCatalogItem('3', 40000);
    assert.equal(coin.itemId, '40522');
    assert.equal(coin.name, '金币果');
    assert.match(coin.image, /40522/);
    assert.equal(coin.priceMismatch, false);

    // 官方配置表已收录 204013（2026-11-26 刷新），名称与图标都来自配置
    const flower = describeCatalogItem('1', 1000000);
    assert.equal(flower.itemId, '204013');
    assert.match(flower.name, /七彩花弦|七色花弦/);
    assert.match(flower.image, /204013/);

    // 服务端改价时打标记，不静默改价
    const changed = describeCatalogItem('3', 41000);
    assert.equal(changed.priceMismatch, true);
});

test('以薯换福：活动窗口与过期标记', () => {
    const { getSweetPotatoWindow } = require('../dist/services/sweet-potato');
    const during = getSweetPotatoWindow(1796000000);
    assert.equal(during.active, true);
    assert.equal(during.expired, false);
    const after = getSweetPotatoWindow(1796900000);
    assert.equal(after.active, false);
    assert.equal(after.expired, true);
    const before = getSweetPotatoWindow(1795500000);
    assert.equal(before.notStarted, true);
});
test('以薯换福：好友铺子票据从分享链接里抽取', () => {
    const { extractShopToken } = require('../dist/services/sweet-potato');
    const uuid = '1f35c32b-0358-46b3-8b18-7dca64dd4baf';
    assert.equal(extractShopToken(uuid), uuid);
    assert.equal(extractShopToken(`https://appservice.qq.com/x?ticket=${uuid.toUpperCase()}&x=1`), uuid);
    assert.equal(extractShopToken('  '), '');
    assert.equal(extractShopToken('no-ticket-here'), '');
});

test('以薯换福：带票据的查铺子请求与官方抓包逐字节一致', async () => {
    await loadProto();
    const body = Buffer.from(types.YshfOperateRequest.encode(types.YshfOperateRequest.create({
        activity_id: '2026111708',
        cmd: 92,
        params_192: {
            shop_gid: '1031121300',
            ticket: {
                activity_id: '2026111708',
                shop_gid: '1031121300',
                nonce: '1f35c32b-0358-46b3-8b18-7dca64dd4baf',
            },
        },
    })).finish());
    assert.equal(body.toString('hex'),
        '08dc8590c607105c820c3a0894d3d6eb03123208dc8590c6071094d3d6eb031a24'
        + '31663335633332622d303335382d343662332d386231382d376463613634646434626166');
});
