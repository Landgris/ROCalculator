
 <el-collapse>
   <el-collapse-item>
  <template slot="title">一般<i class="header-icon el-icon-info"></i></template>
    <template slot="title">
      一致性 Consistency<i class="header-icon el-icon-info"></i>
    </template>
  </el-collapse-item>
  <el-collapse-item title="反馈 Feedback">
  </el-collapse-item>
  <el-collapse-item title="效率 Efficiency">
  </el-collapse-item>
  <el-collapse-item title="可控 Controllability">
  </el-collapse-item>
</el-collapse>

 <el-collapse>
   <el-collapse-item>
  <template slot="title">一般<i class="header-icon el-icon-info"></i></template>
    <template slot="title">
    <div class="textcenter grid-content">
      劍士
      </div>
    </template>
  </el-collapse-item>
</el-collapse>



                                <div v-on:click="TogglePanel('MATKCompute')">
                                <el-row class="titlebox" type="flex" align="middle" style="height:40px;">
                                    <el-col class="textcenter" :span="2">
                                    </el-col>
                                    <el-col class="textcenter" :span="2">
                                    </el-col>
                                    <el-col class="textcenter" :span="20">
                                        <span class="textcenter">MATK計算</span>
                                    </el-col>
                                    <el-col v-if="UIPanel['MATKCompute']" class="textcenter" :span="2">
                                        <i class="el-icon-arrow-down"></i>
                                    </el-col>
                                    <el-col v-else="UIPanel['ATKMATKComputeCompute']" class="textcenter" :span="2">
                                        <i class="el-icon-arrow-up"></i>
                                    </el-col>
                                </el-row>
                                </div>
                                <el-collapse-transition>
                                    <div v-show="UIPanel['MATKCompute']">
                                    